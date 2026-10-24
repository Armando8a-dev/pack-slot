// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PackSlot} from "../src/PackSlot.sol";

contract PackSlotTest is Test {
    PackSlot public slot;

    function setUp() public {
        slot = new PackSlot();
    }

    // ─── Bit packing ─────────────────────────────────────────────────────

    function test_SetAndGetCell() public {
        slot.setCell(0, 100);
        slot.setCell(7, 42);
        assertEq(slot.getCell(0), 100, "cell0");
        assertEq(slot.getCell(7), 42, "cell7");
    }

    function test_CellsAreIndependent() public {
        slot.setCell(0, 1);
        slot.setCell(1, 2);
        slot.setCell(2, 3);

        // Changing cell 0 must not disturb cells 1 and 2.
        slot.setCell(0, 999);
        assertEq(slot.getCell(0), 999, "cell0 overwritten");
        assertEq(slot.getCell(1), 2, "cell1 untouched");
        assertEq(slot.getCell(2), 3, "cell2 untouched");
    }

    function test_RawWordChangesWithCells() public {
        assertEq(slot.rawWord(), 0, "starts empty");
        slot.setCell(0, 1);
        assertGt(slot.rawWord(), 0, "slot is non-zero after a write");
    }

    // ─── Safe math (overflow) ────────────────────────────────────────────

    function test_Increment() public {
        slot.setCell(3, 10);
        slot.increment(3, 5);
        assertEq(slot.getCell(3), 15, "10 + 5 = 15");
    }

    function test_Increment_RevertsOnUint32Overflow() public {
        slot.setCell(1, type(uint32).max); // 2^32 - 1
        vm.expectRevert(PackSlot.Overflow.selector);
        slot.increment(1, 1); // would wrap to 0 without the check
    }

    function test_Increment_RevertsOnZeroDelta() public {
        slot.setCell(0, 5);
        vm.expectRevert(PackSlot.ZeroValue.selector);
        slot.increment(0, 0);
    }

    function testFuzz_Increment_NeverOverflows(uint32 start, uint32 delta) public {
        vm.assume(delta > 0);
        // Skip the cases that should revert; the rest must never wrap.
        vm.assume(uint64(start) + uint64(delta) <= type(uint32).max);
        slot.setCell(0, start);
        slot.increment(0, delta);
        assertEq(slot.getCell(0), start + delta, "sum must be exact");
    }

    // ─── Guards ──────────────────────────────────────────────────────────

    function test_SetCell_RevertsOnBadIndex() public {
        vm.expectRevert(PackSlot.ZeroValue.selector);
        slot.setCell(8, 1); // 8 * 32 = 256 -> out of word range
    }

    function test_OnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(PackSlot.NotOwner.selector);
        slot.setCell(0, 1);
    }

    function test_PausedBlocksWrites() public {
        slot.setPaused(true);
        vm.expectRevert(PackSlot.Paused.selector);
        slot.setCell(0, 1);
    }

    // ─── isContract (extcodesize) ────────────────────────────────────────

    function test_IsContract() public view {
        assertTrue(slot.isContract(address(slot)), "this contract has code");
        assertFalse(slot.isContract(address(0xBEEF)), "EOA has no code");
    }

    // ─── Reset ───────────────────────────────────────────────────────────

    function test_ResetClearsEverything() public {
        slot.setCell(0, 1);
        slot.setCell(7, 9);
        slot.reset();
        assertEq(slot.rawWord(), 0, "single sstore(0) wipes all cells");
    }
}
