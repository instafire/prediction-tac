// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionPoolV3.sol";

contract PredictionPoolV3Test is Test {
    PredictionPoolV3 public pool;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public dave = makeAddr("dave");

    function setUp() public {
        vm.prank(owner);
        pool = new PredictionPoolV3();

        vm.deal(alice, 100_000 ether);
        vm.deal(bob, 100_000 ether);
        vm.deal(carol, 100_000 ether);
        vm.deal(dave, 100_000 ether);

        vm.prank(alice);
        pool.deposit{value: 10_000 ether}();
        vm.prank(bob);
        pool.deposit{value: 10_000 ether}();
        vm.prank(carol);
        pool.deposit{value: 10_000 ether}();
    }

    function _createMarket() internal returns (uint256) {
        vm.prank(alice);
        return pool.createMarket("Will TAC hit $1?", "desc", "crypto", uint64(block.timestamp + 7 days), 100 ether);
    }

    // ──── Vault ────

    function test_Deposit() public {
        vm.prank(dave);
        pool.deposit{value: 500 ether}();
        assertEq(pool.vaultBalance(dave), 500 ether);
    }

    function test_DepositViaReceive() public {
        vm.prank(dave);
        (bool s,) = address(pool).call{value: 100 ether}("");
        assertTrue(s);
        assertEq(pool.vaultBalance(dave), 100 ether);
    }

    function test_Withdraw() public {
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        pool.withdraw(5_000 ether);
        assertEq(pool.vaultBalance(alice), 5_000 ether);
        assertEq(alice.balance, balBefore + 5_000 ether);
    }

    function test_WithdrawAll() public {
        vm.prank(alice);
        pool.withdrawAll();
        assertEq(pool.vaultBalance(alice), 0);
    }

    function test_WithdrawTooMuchReverts() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        pool.withdraw(50_000 ether);
    }

    function test_ZeroDepositReverts() public {
        vm.prank(dave);
        vm.expectRevert("Zero deposit");
        pool.deposit{value: 0}();
    }

    // ──── Market creation ────

    function test_CreateMarket() public {
        uint256 id = _createMarket();
        assertEq(id, 1);
        assertEq(pool.vaultBalance(alice), 9_900 ether);
        (address creator, string memory q,,,,,, uint256 yes, uint256 no,,, uint32 yb,) = pool.getMarketInfo(1);
        assertEq(creator, alice);
        assertEq(q, "Will TAC hit $1?");
        assertEq(yes, 100 ether);
        assertEq(no, 0);
        assertEq(yb, 1);
    }

    function test_CreateInsufficientVaultReverts() public {
        vm.prank(dave); // no deposit
        vm.expectRevert("Insufficient vault balance");
        pool.createMarket("Q?", "d", "misc", uint64(block.timestamp + 7 days), 100 ether);
    }

    function test_CreateBoundsReverts() public {
        vm.startPrank(alice);
        vm.expectRevert("Empty question");
        pool.createMarket("", "d", "misc", uint64(block.timestamp + 7 days), 100 ether);

        vm.expectRevert("Stake out of bounds");
        pool.createMarket("Q?", "d", "misc", uint64(block.timestamp + 7 days), 0.001 ether);

        vm.expectRevert("Duration too short");
        pool.createMarket("Q?", "d", "misc", uint64(block.timestamp + 30 minutes), 100 ether);

        vm.expectRevert("Duration too long");
        pool.createMarket("Q?", "d", "misc", uint64(block.timestamp + 400 days), 100 ether);
        vm.stopPrank();
    }

    // ──── Betting ────

    function test_BetFromVault() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);

        uint256 net = 50 ether - (50 ether * 20 / 1000);
        (,,,,,,,, uint256 noPool,,,, uint32 nb) = pool.getMarketInfo(1);
        assertEq(noPool, net);
        assertEq(nb, 1);
        assertEq(pool.vaultBalance(bob), 10_000 ether - 50 ether);
    }

    function test_BetOtherSideReverts() public {
        _createMarket();
        vm.startPrank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        vm.expectRevert("Already on other side");
        pool.bet(1, PredictionPoolV3.Side.Yes, 20 ether);
        vm.stopPrank();
    }

    function test_IncreasePosition() public {
        _createMarket();
        vm.startPrank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        pool.bet(1, PredictionPoolV3.Side.No, 30 ether);
        vm.stopPrank();

        (, uint256 amount,) = pool.getUserBet(1, bob);
        uint256 net = 80 ether - (80 ether * 20 / 1000);
        assertEq(amount, net);
    }

    function test_BetInsufficientVaultReverts() public {
        _createMarket();
        vm.prank(dave);
        vm.expectRevert("Insufficient vault balance");
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
    }

    // ──── Sell position ────

    function test_SellPartialPosition() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        uint256 net = 100 ether - (100 ether * 20 / 1000);

        uint256 vaultBefore = pool.vaultBalance(bob);
        vm.prank(bob);
        pool.sellPosition(1, 40 ether);

        uint256 exitFee = 40 ether * 20 / 1000;
        assertEq(pool.vaultBalance(bob), vaultBefore + 40 ether - exitFee);
        (, uint256 amount,) = pool.getUserBet(1, bob);
        assertEq(amount, net - 40 ether);
        (,,,,,,,, uint256 noPool,,,, uint32 nb) = pool.getMarketInfo(1);
        assertEq(noPool, net - 40 ether);
        assertEq(nb, 1);
    }

    function test_SellFullPositionClearsSide() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        uint256 net = 100 ether - (100 ether * 20 / 1000);

        vm.prank(bob);
        pool.sellPosition(1, net);

        (PredictionPoolV3.Side side, uint256 amount,) = pool.getUserBet(1, bob);
        assertEq(uint8(side), uint8(PredictionPoolV3.Side.None));
        assertEq(amount, 0);
        (,,,,,,,, uint256 noPool,,,, uint32 nb) = pool.getMarketInfo(1);
        assertEq(noPool, 0);
        assertEq(nb, 0);

        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.Yes, 50 ether);
        (PredictionPoolV3.Side side2,,) = pool.getUserBet(1, bob);
        assertEq(uint8(side2), uint8(PredictionPoolV3.Side.Yes));
    }

    function test_SellNoPositionReverts() public {
        _createMarket();
        vm.prank(dave);
        vm.expectRevert("No position");
        pool.sellPosition(1, 10 ether);
    }

    function test_SellTooMuchReverts() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        vm.prank(bob);
        vm.expectRevert("Bad amount");
        pool.sellPosition(1, 60 ether);
    }

    function test_SellAfterExpiryReverts() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        vm.warp(block.timestamp + 8 days);
        vm.prank(bob);
        vm.expectRevert("Market expired");
        pool.sellPosition(1, 10 ether);
    }

    function test_SellKeepsSolvency() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 500 ether);
        uint256 net = 500 ether - (500 ether * 20 / 1000);
        vm.prank(bob);
        pool.sellPosition(1, net / 2);
        (bool solvent,,) = pool.solvencyCheck();
        assertTrue(solvent);
    }

    // ──── Resolution + claims ────

    function test_FullLifecycle_YesWins() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);

        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);

        // dispute window must pass
        vm.prank(alice);
        vm.expectRevert("Dispute window active");
        pool.claim(1);

        vm.warp(block.timestamp + 3 days);
        uint256 vBefore = pool.vaultBalance(alice);
        vm.prank(alice);
        pool.claim(1);
        assertGt(pool.vaultBalance(alice), vBefore);

        PredictionPoolV3.UserStats memory s = pool.getUserStats(alice);
        assertEq(s.wins, 1);
    }

    function test_LoserClaimRecordsLoss() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);

        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);
        vm.warp(block.timestamp + 3 days);

        uint256 vBefore = pool.vaultBalance(bob);
        vm.prank(bob);
        pool.claim(1);
        assertEq(pool.vaultBalance(bob), vBefore); // nothing gained

        PredictionPoolV3.UserStats memory s = pool.getUserStats(bob);
        assertEq(s.losses, 1);
    }

    function test_DoubleClaimReverts() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);
        vm.warp(block.timestamp + 3 days);

        vm.startPrank(alice);
        pool.claim(1);
        vm.expectRevert("Already claimed");
        pool.claim(1);
        vm.stopPrank();
    }

    function test_Dispute() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);

        vm.prank(bob);
        pool.dispute(1);

        vm.prank(owner);
        pool.resolveDispute(1, PredictionPoolV3.Side.No);

        vm.warp(block.timestamp + 3 days);
        uint256 vBefore = pool.vaultBalance(bob);
        vm.prank(bob);
        pool.claim(1);
        assertGt(pool.vaultBalance(bob), vBefore);
    }

    function test_DisputeWindowClosedReverts() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);

        vm.warp(block.timestamp + 3 days);
        vm.prank(bob);
        vm.expectRevert("Dispute window closed");
        pool.dispute(1);
    }

    // ──── Cancel / refund ────

    function test_CancelMarket() public {
        _createMarket();
        vm.prank(alice);
        pool.cancelMarket(1);
        assertEq(pool.vaultBalance(alice), 10_000 ether); // full refund
    }

    function test_CancelWithBettorsReverts() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        vm.prank(alice);
        vm.expectRevert("Has other bettors");
        pool.cancelMarket(1);
    }

    function test_RefundExpired() public {
        _createMarket();
        vm.warp(block.timestamp + 8 days);
        pool.refundExpiredMarket(1);

        vm.prank(alice);
        pool.claimRefund(1);
        assertEq(pool.vaultBalance(alice), 10_000 ether);
    }

    // ──── Admin ────

    function test_SetFee() public {
        vm.prank(owner);
        pool.setProtocolFee(30);
        assertEq(pool.protocolFee(), 30);
    }

    function test_FeeTooHighReverts() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        pool.setProtocolFee(60);
    }

    function test_WithdrawFees() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        assertGt(pool.accumulatedFees(), 0);

        vm.prank(owner);
        pool.withdrawFees(owner);
        assertGt(owner.balance, 0);
        assertEq(pool.accumulatedFees(), 0);
    }

    function test_Pause() public {
        vm.prank(owner);
        pool.setPaused(true);

        vm.prank(alice);
        vm.expectRevert("Contract paused");
        pool.deposit{value: 1 ether}();

        // withdraw still works when paused (users can always exit)
        vm.prank(alice);
        pool.withdraw(100 ether);
    }

    function test_OnlyOwnerAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert();
        pool.setProtocolFee(30);
        vm.expectRevert();
        pool.setPaused(true);
        vm.expectRevert();
        pool.withdrawFees(alice);
        vm.stopPrank();
    }

    // ──── Solvency ────

    function test_Solvency() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        (bool solvent,,) = pool.solvencyCheck();
        assertTrue(solvent);
    }

    function test_UserStats() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);

        PredictionPoolV3.UserStats memory sa = pool.getUserStats(alice);
        assertEq(sa.marketsCreated, 1);
        assertEq(sa.totalStaked, 100 ether);

        PredictionPoolV3.UserStats memory sb = pool.getUserStats(bob);
        assertEq(sb.betsPlaced, 1);
    }

    function test_UserMarketsTracking() public {
        _createMarket();
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 50 ether);
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 25 ether);

        uint256[] memory bMarkets = pool.getUserMarkets(bob);
        assertEq(bMarkets.length, 1); // no duplicates
    }
}
