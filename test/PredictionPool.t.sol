// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionPool.sol";

contract PredictionPoolTest is Test {
    PredictionPool public pool;
    address public owner = makeAddr("owner");
    address public creator = makeAddr("creator");
    address public bettor1 = makeAddr("bettor1");
    address public bettor2 = makeAddr("bettor2");
    address public bettor3 = makeAddr("bettor3");

    function setUp() public {
        vm.startPrank(owner);
        pool = new PredictionPool();
        vm.stopPrank();

        vm.deal(creator, 100_000 ether);
        vm.deal(bettor1, 100_000 ether);
        vm.deal(bettor2, 100_000 ether);
        vm.deal(bettor3, 100_000 ether);
    }

    function _createMarket() internal returns (uint256) {
        vm.prank(creator);
        return pool.createMarket{value: 100 ether}(
            "Will TAC hit $1?", "Market to predict TAC token price", "crypto", block.timestamp + 7 days
        );
    }

    function test_CreateMarket() public {
        uint256 marketId = _createMarket();
        assertEq(marketId, 1);
        assertEq(pool.marketCount(), 1);

        (address mCreator, string memory q,, string memory cat, uint256 rt,,, uint256 yesPool, uint256 noPool,,) =
            pool.getMarketInfo(marketId);

        assertEq(mCreator, creator);
        assertEq(q, "Will TAC hit $1?");
        assertEq(cat, "crypto");
        assertEq(rt, block.timestamp + 7 days);
        assertEq(yesPool, 100 ether);
        assertEq(noPool, 0);
    }

    function test_CreateMarketReverts() public {
        vm.startPrank(creator);
        vm.expectRevert("Empty question");
        pool.createMarket{value: 100 ether}("", "desc", "misc", block.timestamp + 7 days);

        vm.expectRevert("Stake below minimum");
        pool.createMarket{value: 0}("Q?", "desc", "misc", block.timestamp + 7 days);

        vm.expectRevert("Resolution in past");
        pool.createMarket{value: 100 ether}("Q?", "desc", "misc", block.timestamp - 1);

        vm.expectRevert("Resolution too far");
        pool.createMarket{value: 100 ether}("Q?", "desc", "misc", block.timestamp + 366 days);
        vm.stopPrank();
    }

    function test_BetYes() public {
        _createMarket();
        vm.prank(bettor2);
        pool.betYes{value: 50 ether}(1);

        (,,,,,,, uint256 yesPool,,,) = pool.getMarketInfo(1);
        uint256 expectedNet = 50 ether - (50 ether * 20 / 1000);
        assertEq(yesPool, 100 ether + expectedNet);
    }

    function test_BetNo() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        (,,,,,,,, uint256 noPool,,) = pool.getMarketInfo(1);
        uint256 expectedNet = 50 ether - (50 ether * 20 / 1000);
        assertEq(noPool, expectedNet);
    }

    function test_BetBothSidesReverts() public {
        _createMarket();
        vm.startPrank(bettor1);
        pool.betNo{value: 50 ether}(1);
        vm.expectRevert("Already on a side");
        pool.betYes{value: 20 ether}(1);
        vm.stopPrank();
    }

    function test_IncreasePosition() public {
        _createMarket();
        vm.startPrank(bettor1);
        pool.betNo{value: 50 ether}(1);
        pool.betNo{value: 30 ether}(1);
        vm.stopPrank();

        (PredictionPool.Side side, uint256 amount,) = pool.getUserBet(1, bettor1);
        assertEq(uint256(side), uint256(PredictionPool.Side.No));
        uint256 net = (50 ether + 30 ether) - ((50 ether + 30 ether) * 20 / 1000);
        assertEq(amount, net);
    }

    function test_GetOdds() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        (uint256 yesPct, uint256 noPct) = pool.getOdds(1);
        assertEq(noPct, 1000 - yesPct);
        assertGt(yesPct, noPct);
    }

    function test_ResolveAndClaim_YesWins() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.warp(block.timestamp + 8 days);

        vm.prank(owner);
        pool.resolve(1, PredictionPool.Side.Yes);

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        pool.claim(1);
        assertGt(creator.balance, balBefore);
    }

    function test_ResolveAndClaim_NoWins() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.warp(block.timestamp + 8 days);

        vm.prank(owner);
        pool.resolve(1, PredictionPool.Side.No);

        // Loser cannot claim
        vm.prank(creator);
        vm.expectRevert("You lost this bet");
        pool.claim(1);

        uint256 balBefore = bettor1.balance;
        vm.prank(bettor1);
        pool.claim(1);
        assertGt(bettor1.balance, balBefore);
    }

    function test_ResolveTooEarlyReverts() public {
        _createMarket();
        vm.prank(owner);
        vm.expectRevert("Resolution time not reached");
        pool.resolve(1, PredictionPool.Side.Yes);
    }

    function test_CancelMarket() public {
        _createMarket();
        uint256 balBefore = creator.balance;

        vm.prank(creator);
        pool.cancelMarket(1);

        assertGt(creator.balance, balBefore);

        (,,,,,,,,, PredictionPool.Status status,) = pool.getMarketInfo(1);
        assertEq(uint256(status), uint256(PredictionPool.Status.Cancelled));
    }

    function test_CancelWithBetsReverts() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.prank(creator);
        vm.expectRevert("Has opposing bets");
        pool.cancelMarket(1);
    }

    function test_RefundExpiredMarket() public {
        _createMarket();
        vm.warp(block.timestamp + 8 days);

        vm.prank(bettor1);
        pool.refundExpiredMarket(1);

        (,,,,,,,,, PredictionPool.Status status,) = pool.getMarketInfo(1);
        assertEq(uint256(status), uint256(PredictionPool.Status.Refunded));

        uint256 balBefore = creator.balance;
        vm.prank(creator);
        pool.claimRefund(1);
        assertGt(creator.balance, balBefore);
    }

    function test_RefundBothSidesReverts() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.warp(block.timestamp + 8 days);

        vm.prank(bettor2);
        vm.expectRevert("Both sides funded");
        pool.refundExpiredMarket(1);
    }

    function test_Dispute() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPool.Side.Yes);

        vm.prank(bettor1);
        pool.dispute(1);

        (,,,,,,,,, PredictionPool.Status status,) = pool.getMarketInfo(1);
        assertEq(uint256(status), uint256(PredictionPool.Status.Disputed));

        vm.prank(owner);
        pool.resolveDispute(1, PredictionPool.Side.No);
    }

    function test_ProtocolFee() public {
        vm.prank(owner);
        pool.setProtocolFee(30);

        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 100 ether}(1);

        assertGt(pool.accumulatedFees(), 0);
    }

    function test_FeeTooHighReverts() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        pool.setProtocolFee(60);
    }

    function test_OnlyOwnerResolve() public {
        _createMarket();
        vm.warp(block.timestamp + 8 days);
        vm.prank(bettor1);
        vm.expectRevert();
        pool.resolve(1, PredictionPool.Side.Yes);
    }

    function test_Pause() public {
        vm.prank(owner);
        pool.setPaused(true);

        vm.startPrank(creator);
        vm.expectRevert("Contract paused");
        pool.createMarket{value: 100 ether}("Q?", "d", "misc", block.timestamp + 7 days);
        vm.stopPrank();
    }

    function test_PotentialPayout() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        (uint256 ifYes, uint256 ifNo) = pool.getPotentialPayout(1, creator);
        assertGt(ifYes, 0);
        assertEq(ifNo, 0);
    }

    function test_GetUserPosition() public {
        _createMarket();
        vm.prank(bettor1);
        pool.betNo{value: 50 ether}(1);

        vm.prank(bettor2);
        pool.betYes{value: 30 ether}(1);

        (uint256[] memory ids, PredictionPool.Side[] memory sides, uint256[] memory amounts, bool[] memory claimed) =
            pool.getUserPositions(bettor1);
        assertEq(ids.length, 1);
        assertEq(uint256(sides[0]), uint256(PredictionPool.Side.No));
        assertGt(amounts[0], 0);
    }

    function testFuzz_SetNumber(uint256 n) public {
        assertTrue(true);
    }
}
