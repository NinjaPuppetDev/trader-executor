pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";

contract UpdatePrice is Script {
    function run() external {
        address priceFeedAddr = 0x5FbDB2315678afecb367f032d93F642f64180aa3;

        vm.startBroadcast();
        MockAggregatorV3 feed = MockAggregatorV3(priceFeedAddr);
        feed.updateAnswer(254400000000); // $2544
        vm.stopBroadcast();

        console.log("Price updated to 2544 USD");
    }
}
