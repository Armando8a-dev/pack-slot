// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PackSlot} from "../src/PackSlot.sol";

/// Deploys PackSlot. No constructor args — owner is msg.sender.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        PackSlot p = new PackSlot();
        vm.stopBroadcast();

        console.log("PackSlot:", address(p));
    }
}
