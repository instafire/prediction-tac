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
        uint64 resolutionTime;
        uint64 createdAt;
        uint64 resolvedAt;
        uint256 totalYesPool;
        uint256 totalNoPool;
        Status status;
        Side winner;
        uint32 yesBettors;
        uint32 noBettors;
        mapping(address => Side) side;
        mapping(address => uint256) amounts;
        mapping(address => bool) hasClaimed;
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
    event BetPlaced(uint256 indexed marketId, address indexed bettor, Side side, uint256 amount, uint64 timestamp);
    event PositionSold(uint256 indexed marketId, address indexed seller, Side side, uint256 amount, uint256 returned, uint64 timestamp);
    event MarketResolved(uint256 indexed marketId, Side winner, uint256 totalPool, uint64 timestamp);
    event MarketDisputed(uint256 indexed marketId, address indexed disputer, uint64 timestamp);
    event DisputeResolved(uint256 indexed marketId, Side finalOutcome, uint64 timestamp);
    event MarketCancelled(uint256 indexed marketId, uint64 timestamp);
    event MarketRefunded(uint256 indexed marketId, uint64 timestamp);
    event Claimed(uint256 indexed marketId, address indexed claimant, uint256 amount, uint64 timestamp);
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
        m.resolutionTime = resolutionTime;
        m.createdAt = uint64(block.timestamp);
        m.totalYesPool = stake;
        m.side[msg.sender] = Side.Yes;
        m.amounts[msg.sender] = stake;
        m.yesBettors = 1;

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

        _trackUserMarket(msg.sender, marketId);
        userStats[msg.sender].betsPlaced++;
        userStats[msg.sender].totalStaked += stake;

        emit BetPlaced(marketId, msg.sender, side, net, uint64(block.timestamp));
    }

    /// @notice Exit part or all of an open position. Returns stake to vault minus protocol fee.
    ///         Pari-mutuel pools have no market-price exit; this is a stake withdrawal.
    function sellPosition(uint256 marketId, uint256 amount) external notPaused nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Market not open");
        require(block.timestamp < m.resolutionTime, "Market expired");
        Side userSide = m.side[msg.sender];
        require(userSide != Side.None, "No position");
        uint256 held = m.amounts[msg.sender];
        require(amount > 0 && amount <= held, "Bad amount");

        uint256 fee = (amount * protocolFee) / BASIS_POINTS;
        uint256 returned = amount - fee;
        accumulatedFees += fee;

        m.amounts[msg.sender] = held - amount;
        if (userSide == Side.Yes) m.totalYesPool -= amount;
        else m.totalNoPool -= amount;

        if (m.amounts[msg.sender] == 0) {
            m.side[msg.sender] = Side.None;
            if (userSide == Side.Yes) m.yesBettors--;
            else m.noBettors--;
        }

        vaultBalance[msg.sender] += returned;
        totalVaultBalance += returned;

        emit PositionSold(marketId, msg.sender, userSide, amount, returned, uint64(block.timestamp));
    }

    // ════════ RESOLUTION ════════

    function resolve(uint256 marketId, Side outcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Resolution time not reached");
        require(outcome == Side.Yes || outcome == Side.No, "Invalid outcome");

        m.status = Status.Resolved;
        m.winner = outcome;
        m.resolvedAt = uint64(block.timestamp);

        emit MarketResolved(marketId, outcome, m.totalYesPool + m.totalNoPool, uint64(block.timestamp));
    }

    function dispute(uint256 marketId) external notPaused {
        Market storage m = markets[marketId];
        require(m.status == Status.Resolved, "Not resolved");
        require(block.timestamp < uint256(m.resolvedAt) + DISPUTE_WINDOW, "Dispute window closed");
        require(m.side[msg.sender] != Side.None, "Not a participant");

        m.status = Status.Disputed;
        emit MarketDisputed(marketId, msg.sender, uint64(block.timestamp));
    }

    function resolveDispute(uint256 marketId, Side finalOutcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == Status.Disputed, "Not disputed");
        require(finalOutcome == Side.Yes || finalOutcome == Side.No, "Invalid outcome");

        m.status = Status.Resolved;
        m.winner = finalOutcome;
        m.resolvedAt = uint64(block.timestamp);
        emit DisputeResolved(marketId, finalOutcome, uint64(block.timestamp));
    }

    // ════════ CANCEL / REFUND ════════

    function cancelMarket(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator == msg.sender, "Not creator");
        require(m.status == Status.Open, "Not open");
        require(m.totalNoPool == 0 && m.yesBettors == 1, "Has other bettors");

        m.status = Status.Cancelled;
        uint256 refund = m.totalYesPool;
        m.totalYesPool = 0;
        m.hasClaimed[msg.sender] = true;

        vaultBalance[msg.sender] += refund;
        totalVaultBalance += refund;

        emit MarketCancelled(marketId, uint64(block.timestamp));
    }

    function refundExpiredMarket(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Not expired");
        require(m.totalYesPool == 0 || m.totalNoPool == 0, "Both sides funded");

        m.status = Status.Refunded;
        emit MarketRefunded(marketId, uint64(block.timestamp));
    }

    function claimRefund(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Refunded || m.status == Status.Cancelled, "Not refundable");
        require(m.side[msg.sender] != Side.None, "No position");
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
        Side userSide = m.side[msg.sender];
        require(userSide != Side.None, "No position");

        m.hasClaimed[msg.sender] = true;

        if (userSide != m.winner) {
            userStats[msg.sender].losses++;
            return; // loser: nothing to claim, stats updated
        }

        uint256 winnerPool = m.winner == Side.Yes ? m.totalYesPool : m.totalNoPool;
        uint256 totalPool = m.totalYesPool + m.totalNoPool;
        require(winnerPool > 0, "Winner pool empty");

        uint256 share = (m.amounts[msg.sender] * totalPool) / winnerPool;

        vaultBalance[msg.sender] += share;
        totalVaultBalance += share;
        userStats[msg.sender].wins++;
        userStats[msg.sender].totalWon += share;

        emit Claimed(marketId, msg.sender, share, uint64(block.timestamp));
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

    receive() external payable notPaused {
        vaultBalance[msg.sender] += msg.value;
        totalVaultBalance += msg.value;
        emit Deposited(msg.sender, msg.value, vaultBalance[msg.sender]);
    }
}
