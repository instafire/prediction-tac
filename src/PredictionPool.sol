// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title PredictionPool
/// @notice A prediction market where anyone creates a pool with TAC tokens.
///         Creator stakes TAC on YES. Others bet YES or NO. Winner takes the pool.
///         Proportional payout. Refund path for unrated markets. Dispute window.
contract PredictionPool is Ownable, ReentrancyGuard, Pausable {
    uint256 public constant MAX_FEE = 50; // 5% max (50 basis points)
    uint256 public constant BASIS_POINTS = 1000;
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant DISPUTE_WINDOW = 3 days;
    uint256 public constant MAX_RESOLUTION = 365 days;

    uint256 public protocolFee = 20; // 2% default
    uint256 public accumulatedFees;
    uint256 public marketCount;

    enum Side { None, Yes, No }
    enum Status { Open, Resolved, Disputed, Cancelled, Refunded }

    struct Market {
        address creator;
        string question;
        string description;
        string category;
        uint256 resolutionTime;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 totalYesPool;
        uint256 totalNoPool;
        Status status;
        Side winner;
        mapping(address => Side) side;
        mapping(address => uint256) amounts;
        mapping(address => bool) hasClaimed;
    }

    mapping(uint256 => Market) public markets;
    mapping(address => uint256[]) public userMarkets;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        string category,
        uint256 resolutionTime,
        uint256 poolAmount,
        uint256 timestamp
    );

    event BetPlaced(
        uint256 indexed marketId,
        address indexed bettor,
        Side side,
        uint256 amount,
        uint256 timestamp
    );

    event MarketResolved(
        uint256 indexed marketId,
        Side winner,
        uint256 totalPool,
        uint256 timestamp
    );

    event MarketDisputed(uint256 indexed marketId, address indexed disputer, uint256 timestamp);

    event MarketCancelled(uint256 indexed marketId, uint256 timestamp);

    event MarketRefunded(uint256 indexed marketId, uint256 timestamp);

    event Claimed(
        uint256 indexed marketId,
        address indexed claimant,
        uint256 amount,
        uint256 timestamp
    );

    event FeesWithdrawn(address indexed to, uint256 amount);

    event DisputeResolved(uint256 indexed marketId, Side finalOutcome, uint256 timestamp);

    modifier notPaused() {
        require(!paused(), "Contract paused");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // ──── Market Creation ────

    function createMarket(
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 resolutionTime
    )
        external
        payable
        nonReentrant
        notPaused
        returns (uint256)
    {
        require(bytes(question).length > 0, "Empty question");
        require(msg.value >= MIN_STAKE, "Stake below minimum");
        require(resolutionTime > block.timestamp, "Resolution in past");
        require(resolutionTime <= block.timestamp + MAX_RESOLUTION, "Resolution too far");

        uint256 marketId = ++marketCount;
        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.question = question;
        m.description = description;
        m.category = category;
        m.resolutionTime = resolutionTime;
        m.createdAt = block.timestamp;
        m.totalYesPool = msg.value;
        m.side[msg.sender] = Side.Yes;
        m.amounts[msg.sender] = msg.value;
        userMarkets[msg.sender].push(marketId);

        emit MarketCreated(marketId, msg.sender, question, category, resolutionTime, msg.value, block.timestamp);
        return marketId;
    }

    // ──── Betting ────

    function _bet(uint256 marketId, Side side) internal {
        Market storage m = markets[marketId];
        require(m.creator != address(0), "Market not found");
        require(m.status == Status.Open, "Market not open");
        require(block.timestamp < m.resolutionTime, "Market expired");
        require(msg.value >= MIN_STAKE, "Stake below minimum");
        require(side == Side.Yes || side == Side.No, "Invalid side");
        require(
            m.side[msg.sender] == Side.None || m.side[msg.sender] == side,
            "Already on a side"
        );

        m.side[msg.sender] = side;

        uint256 fee = (msg.value * protocolFee) / BASIS_POINTS;
        uint256 netStake = msg.value - fee;
        accumulatedFees += fee;

        if (m.amounts[msg.sender] == 0) {
            userMarkets[msg.sender].push(marketId);
        }

        m.amounts[msg.sender] += netStake;
        if (side == Side.Yes) {
            m.totalYesPool += netStake;
        } else {
            m.totalNoPool += netStake;
        }

        emit BetPlaced(marketId, msg.sender, side, netStake, block.timestamp);
    }

    function betYes(uint256 marketId) external payable nonReentrant notPaused {
        _bet(marketId, Side.Yes);
    }

    function betNo(uint256 marketId) external payable nonReentrant notPaused {
        _bet(marketId, Side.No);
    }

    // ──── Resolution ────

    function resolve(uint256 marketId, Side outcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Resolution time not reached");
        require(outcome != Side.None, "Invalid outcome");

        m.status = Status.Resolved;
        m.winner = outcome;
        m.resolvedAt = block.timestamp;

        uint256 totalPool = m.totalYesPool + m.totalNoPool;
        emit MarketResolved(marketId, outcome, totalPool, block.timestamp);
    }

    // ──── Dispute (during dispute window after resolution) ────

    function dispute(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.status == Status.Resolved, "Not resolved");
        require(block.timestamp < m.resolvedAt + DISPUTE_WINDOW, "Dispute window closed");
        require(
            m.side[msg.sender] != Side.None,
            "Not a participant"
        );

        m.status = Status.Disputed;
        emit MarketDisputed(marketId, msg.sender, block.timestamp);
    }

    function resolveDispute(uint256 marketId, Side finalOutcome) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == Status.Disputed, "Not disputed");
        require(finalOutcome != Side.None, "Invalid outcome");

        m.status = Status.Resolved;
        m.winner = finalOutcome;

        emit DisputeResolved(marketId, finalOutcome, block.timestamp);
    }

    // ──── Cancel (creator only, before any opposing bets) ────

    function cancelMarket(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.creator == msg.sender, "Not creator");
        require(m.status == Status.Open, "Not open");
        require(m.totalNoPool == 0, "Has opposing bets");

        m.status = Status.Cancelled;
        m.winner = Side.None;

        // Refund creator stake (minus fees already taken at creation — there were none)
        uint256 refund = m.totalYesPool;
        m.totalYesPool = 0;
        m.hasClaimed[m.creator] = true;

        (bool sent, ) = payable(m.creator).call{value: refund}("");
        require(sent, "Refund failed");

        emit MarketCancelled(marketId, block.timestamp);
    }

    // ──── Refund (auto-refund everyone if market never got opposing bets and expired) ────

    function refundExpiredMarket(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Open, "Not open");
        require(block.timestamp >= m.resolutionTime, "Not expired");
        require(m.totalYesPool == 0 || m.totalNoPool == 0, "Both sides funded");

        m.status = Status.Refunded;
        m.winner = Side.None;

        emit MarketRefunded(marketId, block.timestamp);
        // Users claim via claimRefund()
    }

    function claimRefund(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Refunded || m.status == Status.Cancelled, "Not refundable");
        require(m.side[msg.sender] != Side.None, "No position");
        require(!m.hasClaimed[msg.sender], "Already claimed");

        m.hasClaimed[msg.sender] = true;
        uint256 amount = m.amounts[msg.sender];

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Transfer failed");

        emit Claimed(marketId, msg.sender, amount, block.timestamp);
    }

    // ──── Claiming winnings ────

    function claim(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == Status.Resolved, "Not resolved");
        require(!m.hasClaimed[msg.sender], "Already claimed");
        require(m.side[msg.sender] == m.winner, "You lost this bet");
        require(m.side[msg.sender] != Side.None, "No position");

        m.hasClaimed[msg.sender] = true;

        uint256 winnerPool = m.winner == Side.Yes ? m.totalYesPool : m.totalNoPool;
        uint256 totalPool = m.totalYesPool + m.totalNoPool;
        require(winnerPool > 0, "Winner pool empty");

        uint256 share = (m.amounts[msg.sender] * totalPool) / winnerPool;

        (bool sent, ) = payable(msg.sender).call{value: share}("");
        require(sent, "Transfer failed");

        emit Claimed(marketId, msg.sender, share, block.timestamp);
    }

    // ──── Views ────

    function getMarketInfo(uint256 marketId)
        external
        view
        returns (
            address creator,
            string memory question,
            string memory description,
            string memory category,
            uint256 resolutionTime,
            uint256 createdAt,
            uint256 resolvedAt,
            uint256 totalYesPool,
            uint256 totalNoPool,
            Status status,
            Side winner
        )
    {
        Market storage m = markets[marketId];
        return (
            m.creator,
            m.question,
            m.description,
            m.category,
            m.resolutionTime,
            m.createdAt,
            m.resolvedAt,
            m.totalYesPool,
            m.totalNoPool,
            m.status,
            m.winner
        );
    }

    function getUserBet(uint256 marketId, address user)
        external
        view
        returns (Side side, uint256 amount, bool claimed)
    {
        Market storage m = markets[marketId];
        return (m.side[user], m.amounts[user], m.hasClaimed[user]);
    }

    function getOdds(uint256 marketId)
        external
        view
        returns (uint256 yesPercent, uint256 noPercent)
    {
        Market storage m = markets[marketId];
        uint256 total = m.totalYesPool + m.totalNoPool;
        if (total == 0) return (500, 500);
        yesPercent = (m.totalYesPool * 1000) / total;
        noPercent = 1000 - yesPercent;
    }

    function getPotentialPayout(uint256 marketId, address user)
        external
        view
        returns (uint256 ifYes, uint256 ifNo)
    {
        Market storage m = markets[marketId];
        uint256 userAmt = m.amounts[user];
        if (userAmt == 0) return (0, 0);
        uint256 total = m.totalYesPool + m.totalNoPool;
        if (m.side[user] == Side.Yes) {
            ifYes = m.totalYesPool > 0 ? (userAmt * total) / m.totalYesPool : 0;
            ifNo = 0;
        } else if (m.side[user] == Side.No) {
            ifNo = m.totalNoPool > 0 ? (userAmt * total) / m.totalNoPool : 0;
            ifYes = 0;
        }
    }

    function getUserPositions(address user)
        external
        view
        returns (uint256[] memory ids, Side[] memory sides, uint256[] memory amounts, bool[] memory claimed)
    {
        uint256[] storage ids_ = userMarkets[user];
        uint256 len = ids_.length;
        ids = new uint256[](len);
        sides = new Side[](len);
        amounts = new uint256[](len);
        claimed = new bool[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 mid = ids_[i];
            Market storage m = markets[mid];
            ids[i] = mid;
            sides[i] = m.side[user];
            amounts[i] = m.amounts[user];
            claimed[i] = m.hasClaimed[user];
        }
    }

    // ──── Admin ────

    function setProtocolFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "Fee too high");
        protocolFee = newFee;
    }

    function withdrawFees(address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Transfer failed");
        emit FeesWithdrawn(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) _pause();
        else _unpause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
