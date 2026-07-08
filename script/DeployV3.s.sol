// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PredictionPoolV3} from "../src/PredictionPoolV3.sol";

contract DeployV3 is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        PredictionPoolV3 pool = new PredictionPoolV3();
        console.log("PredictionPoolV3 deployed at:", address(pool));
        vm.stopBroadcast();
    }
}
