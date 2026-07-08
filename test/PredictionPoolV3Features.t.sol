// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionPoolV3.sol";

contract PredictionPoolV3FeaturesTest is Test {
    PredictionPoolV3 public pool;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    function setUp() public {
        vm.prank(owner);
        pool = new PredictionPoolV3();
        vm.deal(alice, 100_000 ether);
        vm.deal(bob, 100_000 ether);
        vm.deal(carol, 100_000 ether);
        vm.prank(alice); pool.deposit{value: 10_000 ether}();
        vm.prank(bob); pool.deposit{value: 10_000 ether}();
        vm.prank(carol); pool.deposit{value: 10_000 ether}();
    }

    function test_ClaimMany() public {
        // market 1 YES wins for alice
        vm.prank(alice);
        pool.createMarket("Q1?", "d", "crypto", uint64(block.timestamp + 7 days), 100 ether);
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);

        // market 2 YES wins for alice
        vm.prank(alice);
        pool.createMarket("Q2?", "d", "crypto", uint64(block.timestamp + 7 days), 50 ether);
        vm.prank(bob);
        pool.bet(2, PredictionPoolV3.Side.No, 50 ether);

        vm.warp(block.timestamp + 8 days);
        vm.startPrank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);
        pool.resolve(2, PredictionPoolV3.Side.Yes);
        vm.stopPrank();
        vm.warp(block.timestamp + 3 days);

        uint256 before = pool.vaultBalance(alice);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        vm.prank(alice);
        pool.claimMany(ids);
        assertGt(pool.vaultBalance(alice), before);
        // second claim many should no-op
        vm.prank(alice);
        pool.claimMany(ids);
    }

    function test_CreateWithSource() public {
        vm.prank(alice);
        uint256 id = pool.createMarketWithSource(
            "Will rain?",
            "Environment Canada",
            "misc",
            "https://weather.gc.ca",
            uint64(block.timestamp + 2 days),
            10 ether
        );
        (string memory src, uint8 oc,) = pool.getMarketMeta(id);
        assertEq(src, "https://weather.gc.ca");
        assertEq(oc, 2);
    }

    function test_MultiMarketLifecycle() public {
        string[] memory outcomes = new string[](3);
        outcomes[0] = "Alice";
        outcomes[1] = "Bob";
        outcomes[2] = "Carol";

        vm.prank(alice);
        uint256 id = pool.createMultiMarket(
            "Who wins the race?",
            "Official result",
            "sports",
            "raceboard.example",
            uint64(block.timestamp + 3 days),
            100 ether,
            outcomes
        );

        (string[] memory labels, uint256[] memory pools,) = pool.getMultiMarket(id);
        assertEq(labels.length, 3);
        assertEq(labels[0], "Alice");
        assertEq(pools[0], 100 ether);

        vm.prank(bob);
        pool.betOutcome(id, 1, 80 ether);
        vm.prank(carol);
        pool.betOutcome(id, 2, 60 ether);

        // cannot use binary bet on multi>2
        vm.prank(bob);
        vm.expectRevert("Use betOutcome for multi");
        pool.bet(id, PredictionPoolV3.Side.Yes, 10 ether);

        uint256 t0 = block.timestamp;
        vm.warp(t0 + 4 days);
        vm.prank(owner);
        pool.resolveOutcome(id, 1); // Bob wins

        vm.warp(t0 + 4 days + 3 days + 1);
        uint256 bobBefore = pool.vaultBalance(bob);
        vm.prank(bob);
        pool.claim(id);
        assertGt(pool.vaultBalance(bob), bobBefore);

        // alice lost
        uint256 aliceBefore = pool.vaultBalance(alice);
        vm.prank(alice);
        pool.claim(id);
        assertEq(pool.vaultBalance(alice), aliceBefore);
    }

    function test_MarketsPage() public {
        vm.prank(alice);
        pool.createMarket("A", "d", "misc", uint64(block.timestamp + 2 days), 10 ether);
        vm.prank(alice);
        pool.createMarket("B", "d", "misc", uint64(block.timestamp + 2 days), 10 ether);
        vm.prank(alice);
        pool.createMarket("C", "d", "misc", uint64(block.timestamp + 2 days), 10 ether);

        (uint256[] memory ids, uint256 total) = pool.getMarketsPage(0, 2);
        assertEq(total, 3);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);

        (ids, total) = pool.getMarketsPage(2, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], 3);
    }

    function test_PostComment() public {
        vm.prank(alice);
        pool.createMarket("Q", "d", "misc", uint64(block.timestamp + 2 days), 10 ether);
        vm.prank(bob);
        pool.postComment(1, "Looks like YES to me");
        // empty reverts
        vm.prank(bob);
        vm.expectRevert("Bad comment");
        pool.postComment(1, "");
    }

    function test_ClaimManySkipsUnclaimable() public {
        vm.prank(alice);
        pool.createMarket("Q1?", "d", "crypto", uint64(block.timestamp + 7 days), 100 ether);
        vm.prank(bob);
        pool.bet(1, PredictionPoolV3.Side.No, 100 ether);
        vm.warp(block.timestamp + 8 days);
        vm.prank(owner);
        pool.resolve(1, PredictionPoolV3.Side.Yes);
        // still in dispute window — claimMany should no-op (not revert)
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 99; // missing market
        uint256 before = pool.vaultBalance(alice);
        vm.prank(alice);
        pool.claimMany(ids);
        assertEq(pool.vaultBalance(alice), before);
        // after dispute window, claim works
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        pool.claimMany(ids);
        assertGt(pool.vaultBalance(alice), before);
    }

    function test_SellMultiPosition() public {
        string[] memory outcomes = new string[](3);
        outcomes[0] = "A";
        outcomes[1] = "B";
        outcomes[2] = "C";
        vm.prank(alice);
        uint256 id = pool.createMultiMarket("Who?", "d", "sports", "src", uint64(block.timestamp + 3 days), 100 ether, outcomes);
        vm.prank(bob);
        pool.betOutcome(id, 1, 50 ether);
        uint256 before = pool.vaultBalance(bob);
        uint256 held = 50 ether - (50 ether * 20 / 1000);
        vm.prank(bob);
        pool.sellPosition(id, held / 2);
        assertGt(pool.vaultBalance(bob), before);
    }

    function test_MultiDispute() public {
        string[] memory outcomes = new string[](3);
        outcomes[0] = "A";
        outcomes[1] = "B";
        outcomes[2] = "C";
        vm.prank(alice);
        uint256 id = pool.createMultiMarket("Who?", "d", "sports", "src", uint64(block.timestamp + 2 days), 50 ether, outcomes);
        vm.prank(bob);
        pool.betOutcome(id, 1, 50 ether);

        uint256 t0 = block.timestamp;
        vm.warp(t0 + 3 days);
        vm.prank(owner);
        pool.resolveOutcome(id, 0);

        vm.prank(bob);
        pool.dispute(id);
        vm.prank(owner);
        pool.resolveMultiDispute(id, 1);

        vm.warp(t0 + 3 days + 3 days + 1);
        uint256 before = pool.vaultBalance(bob);
        vm.prank(bob);
        pool.claim(id);
        assertGt(pool.vaultBalance(bob), before);
    }
}
