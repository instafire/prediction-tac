// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

contract DeployPredictionPool is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        PredictionPool pool = new PredictionPool();

        console.log("PredictionPool deployed at:", address(pool));

        vm.stopBroadcast();
    }
}
