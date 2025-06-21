// script/SimulateDownSpike.s.sol
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {SimulatePriceMovement} from "./SimulatePriceMovement.s.sol";

contract SimulateDownSpike is Script {
    function run() external {
        SimulatePriceMovement simulator = new SimulatePriceMovement();
        simulator.run(false); // false for downward spike
    }
}
