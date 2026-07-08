// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PredictionPoolV3
/// @notice Prediction market with a master vault. Users deposit TAC once,
///         bet from internal balance. Winnings credit back to vault balance.
///         Pull-payment pattern throughout. Fair resolution with disputes,
///         refunds, cancellation, and on-chain user stats.
contract PredictionPoolV3 is Ownable, ReentrancyGuard {
    // ──── Constants ────
    uint256 public constant MAX_FEE = 50;            // 5% cap (basis points /1000)
    uint256 public constant BASIS_POINTS = 1000;
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant MAX_STAKE = 1_000_000 ether;
    uint256 public constant DISPUTE_WINDOW = 3 days;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_QUESTION_LEN = 200;
    uint256 public constant MAX_DESC_LEN = 1000;
    uint256 public constant MAX_SOURCE_LEN = 300;
    uint256 public constant MAX_OUTCOMES = 8;
    uint256 public constant MIN_OUTCOMES = 2;
    uint256 public constant MAX_COMMENT_LEN = 280;
    uint256 public constant MAX_OUTCOME_LABEL_LEN = 48;

    // ──── State ────
    uint256 public protocolFee = 20;                 // 2% default
    uint256 public accumulatedFees;
    uint256 public marketCount;
    bool public paused;
    uint256 public totalVaultBalance;                // sum of all user balances (solvency check)

    enum Side { None, Yes, No }
    enum Status { Open, Resolved, Disputed, Cancelled, Refunded }

    struct Market {
        address creator;
        string question;
        string description;
        string category;
        string resolutionSource;                     // oracle / data source URL or description
        uint64 resolutionTime;
        uint64 createdAt;
        uint64 resolvedAt;
        uint256 totalYesPool;
        uint256 totalNoPool;
        Status status;
        Side winner;
        uint32 yesBettors;
        uint32 noBettors;
        uint8 outcomeCount;                          // 2 = binary YES/NO; 3–8 = multi-outcome
        uint8 winnerOutcome;                         // multi: 0-based winner index; binary unused
        mapping(address => Side) side;               // binary path
        mapping(address => uint256) amounts;
        mapping(address => bool) hasClaimed;
        mapping(uint8 => uint256) multiPools;        // multi-outcome pools
        mapping(uint8 => uint32) multiBettors;
        mapping(uint8 => string) outcomeLabels;
        mapping(address => uint8) multiSide;         // 0 = none; 1..outcomeCount = outcome index+1
    }

    struct UserStats {
        uint64 marketsCreated;
        uint64 betsPlaced;
        uint64 wins;
        uint64 losses;
        uint256 totalStaked;
        uint256 totalWon;
    }

    mapping(uint256 => Market) public markets;
    mapping(address => uint256) public vaultBalance;     // internal TAC balance
    mapping(address => uint256[]) public userMarkets;    // markets user participated in
    mapping(address => mapping(uint256 => bool)) private inUserMarkets;
    mapping(address => UserStats) public userStats;

    // ──── Events ────
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event MarketCreated(uint256 indexed marketId, address indexed creator, string question, string category, uint64 resolutionTime, uint256 stake, uint64 timestamp);
    event MultiMarketCreated(uint256 indexed marketId, address indexed creator, string question, uint8 outcomeCount, uint64 resolutionTime, uint256 stake, uint64 timestamp);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, Side side, uint256 amount, uint64 timestamp);
    event MultiBetPlaced(uint256 indexed marketId, address indexed bettor, uint8 outcomeIndex, uint256 amount, uint64 timestamp);
    event PositionSold(uint256 indexed marketId, address indexed seller, Side side, uint256 amount, uint256 returned, uint64 timestamp);
    event MultiPositionSold(uint256 indexed marketId, address indexed seller, uint8 outcomeIndex, uint256 amount, uint256 returned, uint64 timestamp);
    event MarketResolved(uint256 indexed marketId, Side winner, uint256 totalPool, uint64 timestamp);
    event MultiMarketResolved(uint256 indexed marketId, uint8 winnerOutcome, uint256 totalPool, uint64 timestamp);
    event MarketDisputed(uint256 indexed marketId, address indexed disputer, uint64 timestamp);
    event DisputeResolved(uint256 indexed marketId, Side finalOutcome, uint64 timestamp);
    event MultiDisputeResolved(uint256 indexed marketId, uint8 finalOutcome, uint64 timestamp);
    event MarketCancelled(uint256 indexed marketId, uint64 timestamp);
    event MarketRefunded(uint256 indexed marketId, uint64 timestamp);
    event Claimed(uint256 indexed marketId, address indexed claimant, uint256 amount, uint64 timestamp);
    event BatchClaimed(address indexed user, uint256 count, uint256 totalAmount);
    event CommentPosted(uint256 indexed marketId, address indexed author, string body, uint64 timestamp);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event FeeSet(uint256 newFee);

    // ──── Modifiers ────
    modifier notPaused() {
        require(!paused, "Contract paused");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // ════════ VAULT ════════

    function deposit() external payable notPaused nonReentrant {
        require(msg.value > 0, "Zero deposit");
        vaultBalance[msg.sender] += msg.value;
        totalVaultBalance += msg.value;
        emit Deposited(msg.sender, msg.value, vaultBalance[msg.sender]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero withdraw");
        uint256 bal = vaultBalance[msg.sender];
        require(bal >= amount, "Insufficient balance");
        vaultBalance[msg.sender] = bal - amount;
        totalVaultBalance -= amount;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Transfer failed");
        emit Withdrawn(msg.sender, amount, vaultBalance[msg.sender]);
    }

    function withdrawAll() external nonReentrant {
        uint256 bal = vaultBalance[msg.sender];
        require(bal > 0, "Nothing to withdraw");
        vaultBalance[msg.sender] = 0;
        totalVaultBalance -= bal;
        (bool sent, ) = payable(msg.sender).call{value: bal}("");
        require(sent, "Transfer failed");
        emit Withdrawn(msg.sender, bal, 0);
    }

    // ════════ MARKET CREATION ════════

    function createMarket(
        string calldata question,
        string calldata description,
        string calldata category,
        uint64 resolutionTime,
        uint256 stake
    ) external notPaused nonReentrant returns (uint256) {
        return _createBinary(question, description, category, "", resolutionTime, stake);
    }

    /// @notice Binary market with an explicit oracle / resolution source string.
    function createMarketWithSource(
        string calldata question,
        string calldata description,
        string calldata category,
        string calldata resolutionSource,
        uint64 resolutionTime,
        uint256 stake
    ) external notPaused nonReentrant returns (uint256) {
        require(bytes(resolutionSource).length <= MAX_SOURCE_LEN, "Source too long");
        return _createBinary(question, description, category, resolutionSource, resolutionTime, stake);
    }

    /// @notice Multi-outcome market (2–8 labels). Creator stake seeds outcome index 0.
    function createMultiMarket(
        string calldata question,
        string calldata description,
        string calldata category,
        string calldata resolutionSource,
        uint64 resolutionTime,
        uint256 stake,
        string[] calldata outcomes
    ) external notPaused nonReentrant returns (uint256) {
        require(bytes(question).length > 0, "Empty question");
        require(bytes(question).length <= MAX_QUESTION_LEN, "Question too long");
        require(bytes(description).length <= MAX_DESC_LEN, "Description too long");
        require(bytes(resolutionSource).length <= MAX_SOURCE_LEN, "Source too long");
        require(outcomes.length >= MIN_OUTCOMES && outcomes.length <= MAX_OUTCOMES, "Bad outcome count");
        require(stake >= MIN_STAKE && stake <= MAX_STAKE, "Stake out of bounds");
        require(resolutionTime >= block.timestamp + MIN_DURATION, "Duration too short");
        require(resolutionTime <= block.timestamp + MAX_DURATION, "Duration too long");
        require(vaultBalance[msg.sender] >= stake, "Insufficient vault balance");

        for (uint256 i = 0; i < outcomes.length; i++) {
            require(bytes(outcomes[i]).length > 0 && bytes(outcomes[i]).length <= MAX_OUTCOME_LABEL_LEN, "Bad label");
        }

        vaultBalance[msg.sender] -= stake;
        totalVaultBalance -= stake;

        uint256 marketId = ++marketCount;
        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.question = question;
        m.description = description;
        m.category = category;
        m.resolutionSource = resolutionSource;
        m.resolutionTime = resolutionTime;
        m.createdAt = uint64(block.timestamp);
        m.outcomeCount = uint8(outcomes.length);

        for (uint8 i = 0; i < outcomes.length; i++) {
            m.outcomeLabels[i] = outcomes[i];
        }

        // Seed first outcome with creator stake (no fee on creation seed)
        m.multiPools[0] = stake;
        m.multiBettors[0] = 1;
        m.multiSide[msg.sender] = 1; // 1-based
        m.amounts[msg.sender] = stake;

        // Mirror binary pools when exactly 2 outcomes for partial UI compat
        if (outcomes.length == 2) {
            m.totalYesPool = stake;
            m.side[msg.sender] = Side.Yes;
            m.yesBettors = 1;
        }

        _trackUserMarket(msg.sender, marketId);
        userStats[msg.sender].marketsCreated++;
        userStats[msg.sender].totalStaked += stake;

        emit MultiMarketCreated(marketId, msg.sender, question, m.outcomeCount, resolutionTime, stake, uint64(block.timestamp));
        emit MarketCreated(marketId, msg.sender, question, category, resolutionTime, stake, uint64(block.timestamp));
        return marketId;
    }

    function _createBinary(
        string memory question,
        string memory description,
        string memory category,
        string memory resolutionSource,
        uint64 resolutionTime,
        uint256 stake
    ) internal returns (uint256) {
        require(bytes(question).length > 0, "Empty question");
        require(bytes(question).length <= MAX_QUESTION_LEN, "Question too long");
        require(bytes(description).length <= MAX_DESC_LEN, "Description too long");
        require(stake >= MIN_STAKE && stake <= MAX_STAKE, "Stake out of bounds");
        require(resolutionTime >= block.timestamp + MIN_DURATION, "Duration too short");
        require(resolutionTime <= block.timestamp + MAX_DURATION, "Duration too long");
        require(vaultBalance[msg.sender] >= stake, "Insufficient vault balance");

        vaultBalance[msg.sender] -= stake;
        totalVaultBalance -= stake;

        uint256 marketId = ++marketCount;
        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.question = question;
        m.description = description;
        m.category = category;
        m.resolutionSource = resolutionSource;
        m.resolutionTime = resolutionTime;
        m.createdAt = uint64(block.timestamp);
        m.outcomeCount = 2;
        m.outcomeLabels[0] = "YES";
        m.outcomeLabels[1] = "NO";
        m.totalYesPool = stake;
        m.side[msg.sender] = Side.Yes;
        m.amounts[msg.sender] = stake;
        m.yesBettors = 1;
        // multi mirrors for unified reads
        m.multiPools[0] = stake;
        m.multiBettors[0] = 1;
        m.multiSide[msg.sender] = 1;

        _trackUserMarket(msg.sender, marketId);
        userStats[msg.sender].marketsCreated++;
        userStats[msg.sender].totalStaked += stake;

        emit MarketCreated(marketId, msg.sender, question, category, resolutionTime, stake, uint64(block.timestamp));
        return marketId;
    }

    // ════════ BETTING ════════

    function bet(uint256 marketId, Side side, uint256 stake) external notPaused nonReentrant {
        require(side == Side.Yes || side == Side.No, "Invalid side");
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Market not open");
        require(block.timestamp < m.resolutionTime, "Market expired");
        require(m.outcomeCount <= 2, "Use betOutcome for multi");
        require(stake >= MIN_STAKE && stake <= MAX_STAKE, "Stake out of bounds");
        require(vaultBalance[msg.sender] >= stake, "Insufficient vault balance");
        Side existing = m.side[msg.sender];
        require(existing == Side.None || existing == side, "Already on other side");

        vaultBalance[msg.sender] -= stake;
        totalVaultBalance -= stake;

        uint256 fee = (stake * protocolFee) / BASIS_POINTS;
        uint256 net = stake - fee;
        accumulatedFees += fee;

        if (existing == Side.None) {
            m.side[msg.sender] = side;
            if (side == Side.Yes) m.yesBettors++;
            else m.noBettors++;
        }
        m.amounts[msg.sender] += net;
        if (side == Side.Yes) m.totalYesPool += net;
        else m.totalNoPool += net;

        // keep multi mirrors in sync for binary
        uint8 oi = side == Side.Yes ? 0 : 1;
        m.multiPools[oi] += net;
        if (existing == Side.None) {
            m.multiBettors[oi]++;
            m.multiSide[msg.sender] = oi + 1;
        }

        _trackUserMarket(msg.sender, marketId);
        userStats[msg.sender].betsPlaced++;
        userStats[msg.sender].totalStaked += stake;

        emit BetPlaced(marketId, msg.sender, side, net, uint64(block.timestamp));
    }

    /// @notice Stake on a multi-outcome market (0-based outcome index).
    function betOutcome(uint256 marketId, uint8 outcomeIndex, uint256 stake) external notPaused nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Market not open");
        require(block.timestamp < m.resolutionTime, "Market expired");
        require(m.outcomeCount >= 2, "Not multi");
        require(outcomeIndex < m.outcomeCount, "Bad outcome");
        require(stake >= MIN_STAKE && stake <= MAX_STAKE, "Stake out of bounds");
        require(vaultBalance[msg.sender] >= stake, "Insufficient vault balance");

        uint8 existing = m.multiSide[msg.sender]; // 1-based
        require(existing == 0 || existing == outcomeIndex + 1, "Already on other outcome");

        vaultBalance[msg.sender] -= stake;
        totalVaultBalance -= stake;

        uint256 fee = (stake * protocolFee) / BASIS_POINTS;
        uint256 net = stake - fee;
        accumulatedFees += fee;

        if (existing == 0) {
            m.multiSide[msg.sender] = outcomeIndex + 1;
            m.multiBettors[outcomeIndex]++;
            if (m.outcomeCount == 2) {
                m.side[msg.sender] = outcomeIndex == 0 ? Side.Yes : Side.No;
                if (outcomeIndex == 0) m.yesBettors++;
                else m.noBettors++;
            }
        }
        m.amounts[msg.sender] += net;
        m.multiPools[outcomeIndex] += net;
        if (m.outcomeCount == 2) {
            if (outcomeIndex == 0) m.totalYesPool += net;
            else m.totalNoPool += net;
        }

        _trackUserMarket(msg.sender, marketId);
        userStats[msg.sender].betsPlaced++;
        userStats[msg.sender].totalStaked += stake;

        emit MultiBetPlaced(marketId, msg.sender, outcomeIndex, net, uint64(block.timestamp));
        if (m.outcomeCount == 2) {
            emit BetPlaced(marketId, msg.sender, outcomeIndex == 0 ? Side.Yes : Side.No, net, uint64(block.timestamp));
        }
    }

    /// @notice Exit part or all of an open position. Returns stake to vault minus protocol fee.
    ///         Pari-mutuel pools have no market-price exit; this is a stake withdrawal.
    ///         Works for binary (side) and multi-outcome (multiSide) markets.
    function sellPosition(uint256 marketId, uint256 amount) external notPaused nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Market not open");
        require(block.timestamp < m.resolutionTime, "Market expired");
        uint8 multiSide1 = m.multiSide[msg.sender]; // 1-based
        Side userSide = m.side[msg.sender];
        bool isMulti = m.outcomeCount > 2;
        require(userSide != Side.None || multiSide1 != 0, "No position");
        uint256 held = m.amounts[msg.sender];
        require(amount > 0 && amount <= held, "Bad amount");

        uint256 fee = (amount * protocolFee) / BASIS_POINTS;
        uint256 returned = amount - fee;
        accumulatedFees += fee;

        m.amounts[msg.sender] = held - amount;

        if (isMulti) {
            uint8 oi = multiSide1 - 1;
            m.multiPools[oi] -= amount;
            if (m.amounts[msg.sender] == 0) {
                m.multiSide[msg.sender] = 0;
                if (m.multiBettors[oi] > 0) m.multiBettors[oi]--;
            }
            emit MultiPositionSold(marketId, msg.sender, oi, amount, returned, uint64(block.timestamp));
        } else {
            if (userSide == Side.Yes) {
                m.totalYesPool -= amount;
                m.multiPools[0] -= amount;
            } else {
                m.totalNoPool -= amount;
                m.multiPools[1] -= amount;
            }
            if (m.amounts[msg.sender] == 0) {
                m.side[msg.sender] = Side.None;
                m.multiSide[msg.sender] = 0;
                if (userSide == Side.Yes) {
                    if (m.yesBettors > 0) m.yesBettors--;
                    if (m.multiBettors[0] > 0) m.multiBettors[0]--;
                } else {
                    if (m.noBettors > 0) m.noBettors--;
                    if (m.multiBettors[1] > 0) m.multiBettors[1]--;
                }
            }
            emit PositionSold(marketId, msg.sender, userSide, amount, returned, uint64(block.timestamp));
        }

        vaultBalance[msg.sender] += returned;
        totalVaultBalance += returned;
    }

    // ════════ RESOLUTION ════════

    function resolve(uint256 marketId, Side outcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Resolution time not reached");
        require(outcome == Side.Yes || outcome == Side.No, "Invalid outcome");
        require(m.outcomeCount <= 2, "Use resolveOutcome for multi");

        m.status = Status.Resolved;
        m.winner = outcome;
        m.winnerOutcome = outcome == Side.Yes ? 0 : 1;
        m.resolvedAt = uint64(block.timestamp);

        emit MarketResolved(marketId, outcome, m.totalYesPool + m.totalNoPool, uint64(block.timestamp));
    }

    function resolveOutcome(uint256 marketId, uint8 winningOutcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Resolution time not reached");
        require(m.outcomeCount >= 2, "Bad market");
        require(winningOutcome < m.outcomeCount, "Bad outcome");

        m.status = Status.Resolved;
        m.winnerOutcome = winningOutcome;
        m.resolvedAt = uint64(block.timestamp);
        if (m.outcomeCount == 2) {
            m.winner = winningOutcome == 0 ? Side.Yes : Side.No;
            emit MarketResolved(marketId, m.winner, m.totalYesPool + m.totalNoPool, uint64(block.timestamp));
        }
        emit MultiMarketResolved(marketId, winningOutcome, _totalPool(m), uint64(block.timestamp));
    }

    function dispute(uint256 marketId) external notPaused {
        Market storage m = markets[marketId];
        require(m.status == Status.Resolved, "Not resolved");
        require(block.timestamp < uint256(m.resolvedAt) + DISPUTE_WINDOW, "Dispute window closed");
        require(m.side[msg.sender] != Side.None || m.multiSide[msg.sender] != 0, "Not a participant");

        m.status = Status.Disputed;
        emit MarketDisputed(marketId, msg.sender, uint64(block.timestamp));
    }

    function resolveDispute(uint256 marketId, Side finalOutcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == Status.Disputed, "Not disputed");
        require(finalOutcome == Side.Yes || finalOutcome == Side.No, "Invalid outcome");
        require(m.outcomeCount <= 2, "Use resolveMultiDispute");

        m.status = Status.Resolved;
        m.winner = finalOutcome;
        m.winnerOutcome = finalOutcome == Side.Yes ? 0 : 1;
        m.resolvedAt = uint64(block.timestamp);
        emit DisputeResolved(marketId, finalOutcome, uint64(block.timestamp));
    }

    function resolveMultiDispute(uint256 marketId, uint8 finalOutcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == Status.Disputed, "Not disputed");
        require(finalOutcome < m.outcomeCount, "Bad outcome");

        m.status = Status.Resolved;
        m.winnerOutcome = finalOutcome;
        m.resolvedAt = uint64(block.timestamp);
        if (m.outcomeCount == 2) {
            m.winner = finalOutcome == 0 ? Side.Yes : Side.No;
            emit DisputeResolved(marketId, m.winner, uint64(block.timestamp));
        }
        emit MultiDisputeResolved(marketId, finalOutcome, uint64(block.timestamp));
    }

    // ════════ CANCEL / REFUND ════════

    function cancelMarket(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator == msg.sender, "Not creator");
        require(m.status == Status.Open, "Not open");

        // Only creator has a position and no opposing liquidity.
        if (m.outcomeCount > 2) {
            uint256 total = _totalPool(m);
            require(total == m.amounts[msg.sender] && m.amounts[msg.sender] > 0, "Has other bettors");
            uint8 oi = m.multiSide[msg.sender];
            require(oi != 0, "No position");
            m.status = Status.Cancelled;
            uint256 refund = m.amounts[msg.sender];
            m.multiPools[oi - 1] = 0;
            m.amounts[msg.sender] = 0;
            m.multiSide[msg.sender] = 0;
            m.hasClaimed[msg.sender] = true;
            vaultBalance[msg.sender] += refund;
            totalVaultBalance += refund;
        } else {
            require(m.totalNoPool == 0 && m.yesBettors == 1, "Has other bettors");
            m.status = Status.Cancelled;
            uint256 refund = m.totalYesPool;
            m.totalYesPool = 0;
            m.multiPools[0] = 0;
            m.hasClaimed[msg.sender] = true;
            vaultBalance[msg.sender] += refund;
            totalVaultBalance += refund;
        }

        emit MarketCancelled(marketId, uint64(block.timestamp));
    }

    function refundExpiredMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Not expired");
        if (m.outcomeCount <= 2) {
            require(m.totalYesPool == 0 || m.totalNoPool == 0, "Both sides funded");
        } else {
            uint8 funded;
            for (uint8 i = 0; i < m.outcomeCount; i++) {
                if (m.multiPools[i] > 0) funded++;
            }
            require(funded <= 1, "Multiple outcomes funded");
        }

        m.status = Status.Refunded;
        emit MarketRefunded(marketId, uint64(block.timestamp));
    }

    function claimRefund(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Refunded || m.status == Status.Cancelled, "Not refundable");
        require(m.side[msg.sender] != Side.None || m.multiSide[msg.sender] != 0, "No position");
        require(!m.hasClaimed[msg.sender], "Already claimed");

        m.hasClaimed[msg.sender] = true;
        uint256 amount = m.amounts[msg.sender];
        require(amount > 0, "Nothing to refund");

        vaultBalance[msg.sender] += amount;
        totalVaultBalance += amount;

        emit Claimed(marketId, msg.sender, amount, uint64(block.timestamp));
    }

    // ════════ CLAIM WINNINGS ════════

    function claim(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Resolved, "Not resolved");
        require(block.timestamp >= uint256(m.resolvedAt) + DISPUTE_WINDOW, "Dispute window active");
        require(!m.hasClaimed[msg.sender], "Already claimed");
        (bool ok, uint256 paid) = _tryClaimOne(marketId, msg.sender);
        require(ok, "No position");
        if (paid > 0) emit Claimed(marketId, msg.sender, paid, uint64(block.timestamp));
    }

    /// @notice Batch claim resolved / refundable positions. Skips markets that are not claimable.
    function claimMany(uint256[] calldata marketIds) external nonReentrant {
        require(marketIds.length <= 50, "Too many");
        uint256 totalPaid;
        uint256 count;
        for (uint256 i = 0; i < marketIds.length; i++) {
            uint256 id = marketIds[i];
            Market storage m = markets[id];
            if (m.creator == address(0) || m.hasClaimed[msg.sender]) continue;

            if (m.status == Status.Resolved) {
                if (block.timestamp < uint256(m.resolvedAt) + DISPUTE_WINDOW) continue;
                (bool ok, uint256 paid) = _tryClaimOne(id, msg.sender);
                if (!ok) continue;
                count++;
                if (paid > 0) {
                    totalPaid += paid;
                    emit Claimed(id, msg.sender, paid, uint64(block.timestamp));
                }
            } else if (m.status == Status.Refunded || m.status == Status.Cancelled) {
                if (m.amounts[msg.sender] == 0) continue;
                if (m.side[msg.sender] == Side.None && m.multiSide[msg.sender] == 0) continue;
                m.hasClaimed[msg.sender] = true;
                uint256 amount = m.amounts[msg.sender];
                vaultBalance[msg.sender] += amount;
                totalVaultBalance += amount;
                totalPaid += amount;
                count++;
                emit Claimed(id, msg.sender, amount, uint64(block.timestamp));
            }
        }
        emit BatchClaimed(msg.sender, count, totalPaid);
    }

    /// @dev Soft claim: returns (false, 0) instead of reverting so claimMany can skip bad ids.
    function _tryClaimOne(uint256 marketId, address user) internal returns (bool ok, uint256 share) {
        Market storage m = markets[marketId];
        if (m.status != Status.Resolved) return (false, 0);
        if (block.timestamp < uint256(m.resolvedAt) + DISPUTE_WINDOW) return (false, 0);
        if (m.hasClaimed[user]) return (false, 0);

        bool isMulti = m.outcomeCount > 2;
        if (isMulti) {
            uint8 userOut = m.multiSide[user];
            if (userOut == 0) return (false, 0);
            m.hasClaimed[user] = true;
            if (userOut - 1 != m.winnerOutcome) {
                userStats[user].losses++;
                return (true, 0);
            }
            uint256 winnerPool = m.multiPools[m.winnerOutcome];
            uint256 totalPool = _totalPool(m);
            if (winnerPool == 0) return (false, 0);
            share = (m.amounts[user] * totalPool) / winnerPool;
        } else {
            Side userSide = m.side[user];
            if (userSide == Side.None) return (false, 0);
            m.hasClaimed[user] = true;
            if (userSide != m.winner) {
                userStats[user].losses++;
                return (true, 0);
            }
            uint256 winnerPool = m.winner == Side.Yes ? m.totalYesPool : m.totalNoPool;
            uint256 totalPool = m.totalYesPool + m.totalNoPool;
            if (winnerPool == 0) return (false, 0);
            share = (m.amounts[user] * totalPool) / winnerPool;
        }

        vaultBalance[user] += share;
        totalVaultBalance += share;
        userStats[user].wins++;
        userStats[user].totalWon += share;
        return (true, share);
    }

    // ════════ COMMENTS (event log — index off-chain) ════════

    function postComment(uint256 marketId, string calldata body) external notPaused {
        require(markets[marketId].creator != address(0), "Market not found");
        require(bytes(body).length > 0 && bytes(body).length <= MAX_COMMENT_LEN, "Bad comment");
        emit CommentPosted(marketId, msg.sender, body, uint64(block.timestamp));
    }

    // ════════ VIEWS ════════

    function getMarketInfo(uint256 marketId)
        external view
        returns (
            address creator, string memory question, string memory description, string memory category,
            uint64 resolutionTime, uint64 createdAt, uint64 resolvedAt,
            uint256 totalYesPool, uint256 totalNoPool,
            Status status, Side winner, uint32 yesBettors, uint32 noBettors
        )
    {
        Market storage m = markets[marketId];
        return (m.creator, m.question, m.description, m.category, m.resolutionTime, m.createdAt, m.resolvedAt,
                m.totalYesPool, m.totalNoPool, m.status, m.winner, m.yesBettors, m.noBettors);
    }

    function getMarketMeta(uint256 marketId)
        external view
        returns (
            string memory resolutionSource,
            uint8 outcomeCount,
            uint8 winnerOutcome
        )
    {
        Market storage m = markets[marketId];
        return (m.resolutionSource, m.outcomeCount == 0 ? 2 : m.outcomeCount, m.winnerOutcome);
    }

    function getMultiMarket(uint256 marketId)
        external view
        returns (
            string[] memory labels,
            uint256[] memory pools,
            uint32[] memory bettors
        )
    {
        Market storage m = markets[marketId];
        uint8 n = m.outcomeCount == 0 ? 2 : m.outcomeCount;
        labels = new string[](n);
        pools = new uint256[](n);
        bettors = new uint32[](n);
        for (uint8 i = 0; i < n; i++) {
            labels[i] = bytes(m.outcomeLabels[i]).length > 0
                ? m.outcomeLabels[i]
                : (i == 0 ? "YES" : (i == 1 ? "NO" : string(abi.encodePacked("O", _u(i)))));
            if (n == 2 && m.multiPools[0] == 0 && m.multiPools[1] == 0) {
                pools[i] = i == 0 ? m.totalYesPool : m.totalNoPool;
                bettors[i] = i == 0 ? m.yesBettors : m.noBettors;
            } else {
                pools[i] = m.multiPools[i];
                bettors[i] = m.multiBettors[i];
            }
        }
    }

    function getUserMultiBet(uint256 marketId, address user)
        external view
        returns (uint8 outcomeIndex, uint256 amount, bool claimed)
    {
        Market storage m = markets[marketId];
        uint8 s = m.multiSide[user];
        outcomeIndex = s == 0 ? type(uint8).max : s - 1;
        amount = m.amounts[user];
        claimed = m.hasClaimed[user];
    }

    /// @notice Paginated market ids (1-based). Returns up to `limit` ids starting at `offset` (0-based into id space).
    function getMarketsPage(uint256 offset, uint256 limit)
        external view
        returns (uint256[] memory ids, uint256 total)
    {
        total = marketCount;
        if (offset >= total || limit == 0) {
            ids = new uint256[](0);
            return (ids, total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 n = end - offset;
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = offset + i + 1; // market ids are 1-based
        }
    }

    function getUserBet(uint256 marketId, address user)
        external view returns (Side side, uint256 amount, bool claimed)
    {
        Market storage m = markets[marketId];
        return (m.side[user], m.amounts[user], m.hasClaimed[user]);
    }

    function getOdds(uint256 marketId) external view returns (uint256 yesPercent, uint256 noPercent) {
        Market storage m = markets[marketId];
        uint256 total = m.totalYesPool + m.totalNoPool;
        if (total == 0) return (500, 500);
        yesPercent = (m.totalYesPool * 1000) / total;
        noPercent = 1000 - yesPercent;
    }

    function getPotentialPayout(uint256 marketId, address user)
        external view returns (uint256 ifYes, uint256 ifNo)
    {
        Market storage m = markets[marketId];
        uint256 amt = m.amounts[user];
        if (amt == 0) return (0, 0);
        uint256 total = m.totalYesPool + m.totalNoPool;
        if (m.side[user] == Side.Yes && m.totalYesPool > 0) ifYes = (amt * total) / m.totalYesPool;
        if (m.side[user] == Side.No && m.totalNoPool > 0) ifNo = (amt * total) / m.totalNoPool;
    }

    function getUserMarkets(address user) external view returns (uint256[] memory) {
        return userMarkets[user];
    }

    function getUserStats(address user) external view returns (UserStats memory) {
        return userStats[user];
    }

    function balanceOf(address user) external view returns (uint256) {
        return vaultBalance[user];
    }

    function solvencyCheck() public view returns (bool solvent, uint256 contractBalance, uint256 obligations) {
        contractBalance = address(this).balance;
        obligations = totalVaultBalance + accumulatedFees;
        solvent = contractBalance >= obligations;
    }

    function isSolvent() external view returns (bool) {
        (bool solvent, , ) = solvencyCheck();
        return solvent;
    }

    // ════════ ADMIN ════════

    function setProtocolFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "Fee too high");
        protocolFee = newFee;
        emit FeeSet(newFee);
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        uint256 amount = accumulatedFees;
        require(amount > 0, "No fees");
        accumulatedFees = 0;
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Transfer failed");
        emit FeesWithdrawn(to, amount);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    // ════════ INTERNAL ════════

    function _trackUserMarket(address user, uint256 marketId) internal {
        if (!inUserMarkets[user][marketId]) {
            inUserMarkets[user][marketId] = true;
            userMarkets[user].push(marketId);
        }
    }

    function _totalPool(Market storage m) internal view returns (uint256 total) {
        if (m.outcomeCount <= 2) {
            return m.totalYesPool + m.totalNoPool;
        }
        for (uint8 i = 0; i < m.outcomeCount; i++) {
            total += m.multiPools[i];
        }
    }

    function _u(uint8 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        if (v == 1) return "1";
        if (v == 2) return "2";
        if (v == 3) return "3";
        if (v == 4) return "4";
        if (v == 5) return "5";
        if (v == 6) return "6";
        if (v == 7) return "7";
        return "8";
    }

    receive() external payable notPaused {
        vaultBalance[msg.sender] += msg.value;
        totalVaultBalance += msg.value;
        emit Deposited(msg.sender, msg.value, vaultBalance[msg.sender]);
    }
}
