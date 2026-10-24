"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";

// Pending deploy — replace with the real Sepolia address after `forge script`.
const CONTRACT = "0x0000000000000000000000000000000000000000" as const;
const CONTRACT_DEPLOYED = false;

const ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rawWord", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getCell", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "setCell", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "uint32" }], outputs: [] },
  { type: "function", name: "increment", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "uint32" }], outputs: [] },
  { type: "function", name: "reset", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setPaused", stateMutability: "nonpayable", inputs: [{ type: "bool" }], outputs: [] },
] as const;

const CELL_COUNT = 8;
const BITS_PER_CELL = 32;

function toWord(cells: bigint[]): bigint {
  let w = 0n;
  for (let i = 0; i < CELL_COUNT; i++) {
    w = (w << 32n) | (cells[i] ?? 0n);
  }
  return w;
}

function wordToCells(w: bigint): bigint[] {
  const cells: bigint[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    cells[i] = (w >> BigInt(32 * (CELL_COUNT - 1 - i))) & 0xffffffffn;
  }
  return cells;
}

function wordToHex(w: bigint): string {
  return `0x${w.toString(16).padStart(64, "0")}`;
}

function cellToBits(v: bigint): boolean[] {
  const bits: boolean[] = [];
  for (let b = 0; b < BITS_PER_CELL; b++) {
    bits[b] = ((v >> BigInt(BITS_PER_CELL - 1 - b)) & 1n) === 1n;
  }
  return bits;
}

function short(addr?: string) {
  return addr && addr !== "0x0000000000000000000000000000000000000000"
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : "—";
}

export default function Page() {
  const { address, isConnected } = useAccount();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [preview, setPreview] = useState(true);
  const [cellInputs, setCellInputs] = useState<string[]>(Array(CELL_COUNT).fill(""));

  const { data: owner } = useReadContract({ address: CONTRACT, abi: ABI, functionName: "owner" });
  const { data: paused } = useReadContract({ address: CONTRACT, abi: ABI, functionName: "paused" });
  const { data: rawWordLive, refetch } = useReadContract({ address: CONTRACT, abi: ABI, functionName: "rawWord" });
  const { data: cellsLive } = useReadContracts({
    contracts: Array.from({ length: CELL_COUNT }, (_, i) => ({
      address: CONTRACT, abi: ABI, functionName: "getCell", args: [i],
    })),
  });

  const { writeContract, data: hash, error, reset: resetWrite } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const [previewWord, setPreviewWord] = useState(() => {
    const cells = [0xdeadbeefn, 0xc0ffee42n, 0x2an, 0xfeedfacen, 0x1337c0den, 0x8badf00dn, 0xdeadc0den, 0xbabecafe1n & 0xffffffffn];
    return toWord(cells);
  });

  useEffect(() => {
    if (!preview) return;
    const id = setInterval(() => {
      setPreviewWord((w) => {
        const cells = wordToCells(w);
        const i = Math.floor(Math.random() * CELL_COUNT);
        cells[i] = (cells[i] + BigInt(1 + Math.floor(Math.random() * 0xff))) & 0xffffffffn;
        return toWord(cells);
      });
    }, 1600);
    return () => clearInterval(id);
  }, [preview]);

  const isOwner = isConnected && owner && CONTRACT_DEPLOYED
    ? address?.toLowerCase() === owner.toLowerCase()
    : false;

  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (error) { flash("err", shortErr(error)); resetWrite(); }
  }, [error, flash, resetWrite]);

  useEffect(() => {
    if (confirming === false && hash) { flash("ok", "Transaction confirmed"); refetch(); }
  }, [confirming, hash, flash, refetch]);

  const displayWord = preview ? previewWord : (rawWordLive ?? 0n);
  const cells = useMemo(() => wordToCells(displayWord), [displayWord]);

  const bump = (i: number) => {
    if (preview) {
      setPreviewWord((w) => {
        const c = wordToCells(w);
        c[i] = (c[i] + 1n) & 0xffffffffn;
        return toWord(c);
      });
      return;
    }
    writeContract({ address: CONTRACT, abi: ABI, functionName: "increment", args: [i, 1] });
  };

  const resetAll = () => {
    if (preview) { setPreviewWord(0n); return; }
    writeContract({ address: CONTRACT, abi: ABI, functionName: "reset" });
  };

  const setCell = (i: number) => {
    const raw = cellInputs[i].trim();
    if (raw === "") { flash("err", "Type a value first"); return; }
    let v: bigint;
    try { v = BigInt(raw); } catch { flash("err", "Invalid number"); return; }
    if (v > 0xffffffffn) { flash("err", "Max 32 bits (0xffffffff)"); return; }
    if (preview) {
      setPreviewWord((w) => { const c = wordToCells(w); c[i] = v; return toWord(c); });
      setCellInputs((inp) => { const n = [...inp]; n[i] = ""; return n; });
      return;
    }
    writeContract({ address: CONTRACT, abi: ABI, functionName: "setCell", args: [i, Number(v)] });
  };

  const wordHex = wordToHex(displayWord);

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>Pack<span className="accent">Slot</span></h1>
          <p className="sub">
            Eight numbers squeezed into <strong>one storage word</strong> — written with raw
            inline assembly. Watch the word light up as the cells change; that&apos;s 8 slots
            becoming 1.
          </p>
        </div>
        <ConnectButton />
      </div>

      <div className="slot">
        <div className="slot-head">
          <span className="slot-title">one <b>uint256</b> storage slot</span>
          <div className="badges">
            <span className="badge">inline assembly</span>
            <span className="badge">8 × 32-bit</span>
            <span className="badge gas">≈ 1 slot write</span>
          </div>
        </div>

        <div className="wordbar">
          <span className="wordprefix">0x</span>
          {Array.from({ length: CELL_COUNT }, (_, g) => {
            const lit = cells[g] > 0n;
            const start = 2 + g * 8;
            const chunk = wordHex.slice(start, start + 8);
            return (
              <div className="wgroup" key={g}>
                <div className="wnibs">
                  {chunk.split("").map((ch, n) => (
                    <span className="nib" data-lit={lit ? "true" : "false"} key={n}>{ch}</span>
                  ))}
                </div>
                <span className="wlabel">cell {g}</span>
              </div>
            );
          })}
        </div>
        <div className="word-caption">the whole state of the contract — one line</div>

        <div className="cells">
          {cells.map((v, i) => {
            const bits = cellToBits(v);
            return (
              <div className="cell" data-lit={v > 0n ? "true" : "false"} key={i}>
                <div className="cidx">cell {i}</div>
                <div className="cval">{v.toString()}</div>
                <div className="bits">
                  {bits.map((on, b) => <span className="bit" data-on={on ? "true" : "false"} key={b} />)}
                </div>
                <button className="btn" onClick={() => bump(i)} disabled={!preview && (!isConnected || confirming || !!paused)}>
                  +1
                </button>
              </div>
            );
          })}
        </div>

        <div className="controls">
          <span className="status-tag" data-live={preview ? "true" : "false"}>
            {preview ? "● preview — live simulation" : CONTRACT_DEPLOYED ? "● live" : "○ on-chain (not deployed)"}
          </span>
          <div className="grp">
            <button className="btn2 ghost" onClick={() => setPreview((p) => !p)}>
              {preview ? "Read on-chain" : "Back to preview"}
            </button>
            <button className="btn2 danger" onClick={resetAll} disabled={!preview && (!isOwner || confirming)}>
              Reset all
            </button>
          </div>
        </div>

        <div className="controls" style={{ borderTop: "none", marginTop: 8, paddingTop: 0 }}>
          <span className="slot-title" style={{ fontSize: 11 }}>set a cell</span>
          <div className="grp">
            {Array.from({ length: CELL_COUNT }, (_, i) => (
              <input
                key={i}
                className="cellinp"
                value={cellInputs[i]}
                onChange={(e) => { const n = [...cellInputs]; n[i] = e.target.value; setCellInputs(n); }}
                onKeyDown={(e) => { if (e.key === "Enter") setCell(i); }}
                placeholder={`c${i}`}
                aria-label={`cell ${i} value`}
              />
            ))}
            <button className="btn2 ghost" onClick={() => cellInputs.forEach((_, i) => setCell(i))}>Set</button>
          </div>
        </div>

        <p className="note">
          This is the whole lesson: <code>sload</code> the word, mask a 32-bit window,
          <code> or</code> the new value, <code>sstore</code> once. Eight variables would cost
          eight slots; packed, they cost one. Solidity&apos;s overflow checks don&apos;t apply inside
          <code> assembly {"{}"}</code> — they&apos;re rebuilt here by hand.
        </p>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function shortErr(e: unknown) {
  const s = String((e as { shortMessage?: string })?.shortMessage ?? e);
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
}
