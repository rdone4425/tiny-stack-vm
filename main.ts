// Tiny stack VM: runs every program in MAKEFUN_INPUT_DIR and writes its
// stdout.bin and exit.txt to MAKEFUN_OUTPUT_DIR. Node 22, no dependencies.
// ISA: kit's program/generator/subject/ISA.md. One program per instance:
// program.bin is the bytecode, input.bin the bytes IN reads.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode byte -> (immediate bytes << 4) | (pops << 2) | pushes.
// Unknown byte: no entry, trap 5.
const T = new Map([
  [0, 0], [1, 17], [2, 65], [3, 4], [4, 6], [5, 10], [6, 11], [7, 15],
  [16, 9], [17, 9], [18, 9], [19, 9], [20, 9], [21, 9], [22, 9], [23, 5],
  [24, 9], [25, 9], [26, 9], [27, 5], [28, 9], [29, 9], [30, 9],
  [32, 9], [33, 9], [34, 9], [48, 32], [49, 36], [50, 36], [51, 32],
  [52, 0], [64, 5], [65, 8], [80, 4], [81, 4], [82, 1], [83, 4],
]);

function run(p, q) {
  const n = p.length;
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack (return addresses)
  const M = new Int32Array(256); // memory
  const o = new Uint8Array(65536); // output
  let s = 0, c = 0, l = 0, g = 0, pc = 0, t = 0;
  const end = (e) => [o.subarray(0, l), e];
  for (;;) {
    if (t === 1000000) return end(10); // step limit
    if (pc < 0 || pc >= n) return end(9); // pc outside the program
    const op = p[pc];
    const v = T.get(op);
    if (v === undefined) return end(5); // unknown opcode
    const im = v >> 4, po = (v >> 2) & 3, pu = v & 3;
    if (pc + im >= n) return end(9); // immediate cut off by the end
    t++;
    const nx = pc + 1 + im;
    if (s < po) return end(2); // stack underflow
    if (s - po + pu > 256) return end(3); // stack overflow
    pc = nx;
    switch (op) {
      case 0: return end(0); // HALT
      case 1: D[s++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 2: D[s++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break; // PUSH32
      case 3: s--; break; // POP
      case 4: D[s] = D[s - 1]; s++; break; // DUP
      case 5: { const x = D[s - 1]; D[s - 1] = D[s - 2]; D[s - 2] = x; break; } // SWAP
      case 6: D[s] = D[s - 2]; s++; break; // OVER
      case 7: { const x = D[s - 3]; D[s - 3] = D[s - 2]; D[s - 2] = D[s - 1]; D[s - 1] = x; break; } // ROT
      case 23: D[s - 1] = (-D[s - 1]) | 0; break; // NEG, wraps
      case 27: D[s - 1] = ~D[s - 1]; break; // NOT
      case 48: pc = nx + (((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16); break; // JMP
      case 49: if (D[--s] === 0) pc = nx + (((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16); break; // JZ
      case 50: if (D[--s] !== 0) pc = nx + (((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16); break; // JNZ
      case 51: // CALL: push the next instruction's address, jump to the immediate
        if (c === 64) return end(7);
        C[c++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 52: // RET
        if (c === 0) return end(8);
        pc = C[--c];
        break;
      case 64: { // LOAD
        const a = D[s - 1];
        if (a < 0 || a > 255) return end(6);
        D[s - 1] = M[a];
        break;
      }
      case 65: { // STORE: ( v addr -- ), addr is the top
        const a = D[s - 1], x = D[s - 2];
        if (a < 0 || a > 255) return end(6);
        s -= 2;
        M[a] = x;
        break;
      }
      case 80: { // PRINT: decimal ASCII, no newline
        const x = String(D[s - 1]);
        if (l + x.length > 65536) return end(11);
        s--;
        for (let i = 0; i < x.length; i++) o[l++] = x.charCodeAt(i);
        break;
      }
      case 81: // PUTC
        if (l + 1 > 65536) return end(11);
        o[l++] = D[--s] & 255;
        break;
      case 82: D[s++] = g < q.length ? q[g++] : -1; break; // IN
      case 83: return end(D[--s] & 255); // EXIT
      default: { // two-operand arithmetic, logic, shifts and comparisons
        const b = D[s - 1], a = D[s - 2];
        let r;
        if (op === 16) r = (a + b) | 0; // ADD
        else if (op === 17) r = (a - b) | 0; // SUB
        else if (op === 18) r = Math.imul(a, b); // MUL, low 32 bits
        else if (op === 19) { // DIV, truncated toward zero
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 20) { // MOD, sign of a
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 21) { // DIVU
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 22) { // MODU
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 24) r = a & b; // AND
        else if (op === 25) r = a | b; // OR
        else if (op === 26) r = a ^ b; // XOR
        else if (op === 28) r = a << (b & 31); // SHL
        else if (op === 29) r = a >> (b & 31); // SHR, arithmetic
        else if (op === 30) r = (a >>> (b & 31)) | 0; // SHRU, logical
        else if (op === 32) r = a === b ? 1 : 0; // EQ
        else if (op === 33) r = a < b ? 1 : 0; // LT, signed
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU, unsigned
        s -= 2;
        D[s++] = r;
        break;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const [out, exit] = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), exit + '\n');
}
