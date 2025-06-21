// script/SimulateUpSpike.s.sol
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {SimulatePriceMovement} from "./SimulatePriceMovement.s.sol";

contract SimulateUpSpike is Script {
    function run() external {
        SimulatePriceMovement simulator = new SimulatePriceMovement();
        simulator.run(true); // true for upward spike
    }
}
