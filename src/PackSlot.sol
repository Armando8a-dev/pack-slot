// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title PackSlot — 8 cells in a single storage word
/// @author Armando Ochoa
/// @notice A demo of inline assembly (Yul): bit-packing, safe math, manual
///         reverts and code-size detection. Eight uint32 "cells" share ONE
///         256-bit storage slot, and every guard is written by hand in Yul.
///
/// ═══════════════════════════════════════════════════════════════════════
/// THE LESSON: Solidity charges ~20,000 gas for the first write to a fresh
/// storage slot. Eight separate uint32 variables would cost eight slots.
/// Packing them into one uint256 costs a single slot. Same data, ~7x less
/// gas on the first write.
///
/// Layout of the single slot (big-endian, 32 bits per cell):
///   cell0 | cell1 | cell2 | cell3 | cell4 | cell5 | cell6 | cell7
///   bits  [224..255] [192..223] ... down to [0..31]
///
/// SAFETY: assembly bypasses Solidity's overflow checks, so every mutation
/// path re-adds them by hand (see the safeAdd / safeMul below).
// ═══════════════════════════════════════════════════════════════════════
contract PackSlot {
    /// @notice All eight cells live in this one slot.
    uint256 private s_packed; // solhint-disable-line var-name-mixedcase

    /// @notice Owner (for the guarded reset).
    address public immutable owner;

    /// @notice Pause switch for the demo (toggles via `setPaused`).
    bool public paused;

    // ─── Custom errors ──────────────────────────────────────────────────
    // The 4-byte selectors below are computed from the signatures and are
    // reused by the hand-written `revert(ptr, 4)` calls in Yul.
    error NotOwner();       // 0x30cd7471
    error Paused();         // 0x9e87fac8
    error Overflow();       // 0x35278d12
    error ZeroValue();      // 0x1f2a2005
    error NotAContract();   // 0x09ee12d5

    // ─── Events ─────────────────────────────────────────────────────────
    event CellSet(uint8 indexed index, uint32 value);
    event Incremented(uint8 indexed index, uint32 delta, uint32 newValue);
    event Reset(address indexed caller);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 1: BIT PACKING — read / write one cell inside the slot
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Read one cell without decoding the whole word in Solidity.
    /// @dev `shr(shift, slot)` moves the wanted cell into the low 32 bits,
    /// then a 32-bit mask isolates it. shift = index * 32.
    function getCell(uint8 index) external view returns (uint32 value) {
        assembly {
            // index * 32 bits, wrapped to keep the shift well-defined for
            // any uint8 (the Solidity-level guard below rejects index >= 8).
            let shift := mul(index, 32)
            value := and(shr(shift, sload(s_packed.slot)), 0xffffffff)
        }
    }

    /// @notice Overwrite one cell, leaving the other seven untouched.
    /// @dev Read-modify-write in Yul: clear the old 32-bit window, OR in the
    /// new value, then `sstore`. The clear+OR never overflows a uint256.
    function setCell(uint8 index, uint32 value) external onlyOwner {
        if (paused) revert Paused();
        if (index >= 8) revert ZeroValue(); // guard: shift stays < 256
        assembly {
            let shift := mul(index, 32)
            let slot := sload(s_packed.slot)
            // Clear the target window, then place `value` into it.
            let cleared := and(slot, not(shl(shift, 0xffffffff)))
            let updated := or(cleared, shl(shift, value))
            sstore(s_packed.slot, updated)
        }
        emit CellSet(index, value);
    }

    /// @notice Read the whole packed word (for the frontend "one slot" view).
    function rawWord() external view returns (uint256) {
        return s_packed;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 2: SAFE MATH — hand-rolled overflow checks in Yul
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Add a uint32 delta to a cell, reverting on uint32 overflow.
    /// @dev Assembly `add` wraps silently, so we detect overflow and revert
    /// with the `Overflow()` selector before writing back.
    function increment(uint8 index, uint32 delta) external onlyOwner {
        if (paused) revert Paused();
        if (index >= 8) revert ZeroValue();
        if (delta == 0) revert ZeroValue();

        assembly {
            let shift := mul(index, 32)
            let slot := sload(s_packed.slot)
            let current := and(shr(shift, slot), 0xffffffff)

            // Checked addition at the CELL width: the window is 32 bits, so
            // a result above 0xffffffff would corrupt the neighbouring cells
            // when shifted back in. Revert instead.
            let next := add(current, delta)
            if gt(next, 0xffffffff) {
                // revert with Overflow() selector (4 bytes)
                mstore(0x00, 0x35278d1200000000000000000000000000000000000000000000000000000000)
                revert(0x00, 0x04)
            }

            // write the new window back without disturbing neighbours
            let cleared := and(slot, not(shl(shift, 0xffffffff)))
            sstore(s_packed.slot, or(cleared, shl(shift, next)))
        }

        emit Incremented(index, delta, getCellRaw(index));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 3: CODESIZE — detect a contract without an interface
    // ═══════════════════════════════════════════════════════════════════

    /// @notice True if `target` has deployed code (`extcodesize > 0`).
    /// @dev The same primitive OpenZeppelin's Address.isContract() uses.
    /// NOTE: returns false during a constructor — a known limitation.
    function isContract(address target) external view returns (bool result) {
        assembly {
            result := gt(extcodesize(target), 0)
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECTION 4: ADMIN — pause toggle and full reset
    // ═══════════════════════════════════════════════════════════════════

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /// @notice Wipe all eight cells back to zero in a single slot write.
    function reset() external onlyOwner {
        assembly {
            sstore(s_packed.slot, 0)
        }
        emit Reset(msg.sender);
    }

    /// @dev Internal read used by `increment` to emit the post-write value
    /// without re-decoding in Solidity.
    function getCellRaw(uint8 index) internal view returns (uint32 value) {
        assembly {
            value := and(shr(mul(index, 32), sload(s_packed.slot)), 0xffffffff)
        }
    }
}
