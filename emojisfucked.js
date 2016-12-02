/*
 * Brainfucked - A JavaScript pure interpreter for Brainfuck programming language
 *
 * Author: Rahul Anand [ eternalthinker.co ], Nov 2014
 *
 * Independent interpreter module which runs as a Web Worker.
 * Any external JavaScript can use the interpreter through relevant command messages.
 * (see onmessage function, and postMessage calls)
 * This is a pure 'interpreter' except for optional optimizations.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
*/

/* ================== Core Interpreter ================ */

function Interpreter (program, input, optimize)
{
    // Essential components
    this.program = program;
    this.input = input;

    this.pc = 0; // Program counter
    this.inputIdx = 0;
    this.memory = [0];
    this.memoryIdx = 0;
    // this.output = "";

    // Optimization
    this.jumps = { };
    //this.optimized = optimize;

    // Op codes:
    // Negative values - to distinguish from positive values that 
    // we'll use to encode op counts in an optimization
    this.LEFT = -8;
    this.RIGHT = -7;
    this.PLUS = -6;
    this.MINUS = -5;
    this.LOOP_BEGIN = -4;
    this.LOOP_END = -3;
    this.PRINT = -2;
    this.READ = -1;

    // Goodies
    this.startTime = Date.now(); 
    this.runTime = 0;
    this._halt = false;

    // Actions
    this.preProcess(optimize);
    this.runTime += Date.now() - this.startTime;
}

Interpreter.prototype.feedInput = function(input) 
{
    this.input = input;
    this.inputIdx = 0;
}

Interpreter.prototype.halt = function()
{
    this._halt = true;
}

Interpreter.prototype.unhalt = function()
{
    this._halt = false;
}

Interpreter.prototype.fin = function(halted) 
{
    this._halt = true;
    postMessage({ "command": "fin", 
                  "runtime": this.runTime, 
                  "halted": halted, 
                  "memory": { "tape": this.memory, "idx": this.memoryIdx } 
                });
}

Interpreter.prototype.preProcess = function(optimize)
{
    var o_program = [];
    var o_pc = -1;
    var stack = []; // Keep track of brackets and map indices of matches
    /* 
       Optimization mode: encode count of repeated ops
       + + + . . - - - [ [ ] ] , , > > < <  becomes  3 + . . 3 - [ [ ] ] , , 2 > 2 <
    */
    var buffer = { op: null, int_op: 0, count: 0 }; 

    this.program = Array.from(this.program);

    for (var pc = 0; pc < this.program.length; ++pc) {
        var op = this.program[pc];

        // Optimization mode: If ><+- is buffered, and a different op is encountered, write buffer to program source
        if (optimize && buffer.op != null && buffer.op != op) {
            if (buffer.count > 1) {
                o_program.push(buffer.count);
                o_pc++;
            } 
            o_program.push(buffer.int_op);
            o_pc++;
            buffer.op = null;
            buffer.int_op = 0;
            buffer.count = 0;
        }

        switch (op) {
            case '\uD83D\uDC48': { // 👈: <
                if (! optimize) {
                    o_program[++o_pc] = this.LEFT;
                    break;
                }
                // Optimization mode: Just buffer the count of this op as long as it repeats
                // (Likewise for >+-)
                buffer.int_op = this.LEFT;
                buffer.op = op;
                buffer.count++;
                break;
            }
            case '\uD83D\uDC49': { // 👉: >
                if (! optimize) {
                    o_program[++o_pc] = this.RIGHT;
                    break;
                }
                buffer.int_op = this.RIGHT;
                buffer.op = op;
                buffer.count++;
                break;
            }
            case '\uD83D\uDE02': { // 😂: +
                if (! optimize) {
                    o_program[++o_pc] = this.PLUS;
                    break;
                }
                buffer.int_op = this.PLUS;
                buffer.op = op;
                buffer.count++;
                break;
            }
            case '\uD83D\uDE2D': { // 😭: -
                if (! optimize) {
                    o_program[++o_pc] = this.MINUS;
                    break;
                }
                buffer.int_op = this.MINUS;
                buffer.op = op;
                buffer.count++;
                break;
            }
            case '\uD83D\uDE9D':  // 🚝:  [
            {
                o_program[++o_pc] = this.LOOP_BEGIN;
                stack.push(o_pc);
                break;
            }
            case '\uD83D\uDE85':  // 🚅: ]
            {
                o_program[++o_pc] = this.LOOP_END;
                var lmatch = stack.pop();
                this.jumps[lmatch] = o_pc;
                this.jumps[o_pc] = lmatch;
                break;
            }
            case '\uD83E\uDD10': { // 🤐: .
                o_program[++o_pc] = this.PRINT;
                break;
            }
            case '\uD83D\uDE49': // 🙉: ,
            {
                o_program[++o_pc] = this.READ;
                break;
            }
            default:
                break;
        }
    } // End of program

    // Optimization mode: ><+- will remain in buffer if program ends with them
    if (optimize && buffer.op != null) {  
        if (buffer.count > 1) {
            o_program.push(buffer.count);
            o_pc++;
        } 
        o_program.push(buffer.int_op);
        o_pc++;
        buffer.op = null;
        buffer.count = 0;
        buffer.int_op = 0;
    }
    this.program = o_program;
};


Interpreter.prototype.step_run = function()
{
    /*
     * Run in steps of 50,000 iterations; setTimeout() at the end to run next step
     * This momentary relishing of control help listen to control-commands to this Web Worker
    */

    if (this._halt) {
        throw {
            name: "HaltInterpreter",
            level: "PROCEDURAL"
        };
    }

    this.startTime = Date.now();
    var count = 1;
    var iters = 50000;

    while(this.pc < this.program.length && --iters > 0) {
        var op = this.program[this.pc];

        // Optimization mode: Any positive integer is encoded op count
        if (op > 0) {
            count = op;
            op = this.program[++this.pc];
        }

        // Order cases by average frequency
        switch (op) {
            case this.RIGHT: {
                this.memoryIdx += count;
                if (this.memoryIdx >= this.memory.length) {
                    for (var i = this.memoryIdx - this.memory.length; i >= 0; --i) {
                        this.memory[this.memoryIdx - i] = 0;
                    }
                }
                break;
            }
            case this.LEFT: {
                this.memoryIdx -= count;
                if (this.memoryIdx < 0) {
                    throw {
                        name: "MemoryUnderflow",
                        level: "TERMINAL",
                        message: "Program attempted to access out of bound memory"
                    };
                }
                break;
            }
            case this.PLUS: {
                this.memory[this.memoryIdx] = (this.memory[this.memoryIdx] + count) % 256;
                break;
            }
            case this.MINUS: {
                this.memory[this.memoryIdx] -= count;
                if (this.memory[this.memoryIdx] < 0) {
                    this.memory[this.memoryIdx] += 256;
                }
                break;
            }
            case this.LOOP_BEGIN: {
                if (this.memory[this.memoryIdx] == 0) {
                    this.pc = this.jumps[this.pc];
                }
                if (this.pc == undefined) {
                    throw {
                        name: "UnmatchedBrackets",
                        level: "TERMINAL",
                        message: "Unmatched '[' encountered in source code"
                    };
                }
                break;
            }
            case this.LOOP_END: {
                if (this.memory[this.memoryIdx] != 0) {
                    this.pc = this.jumps[this.pc];
                }
                if (this.pc == undefined) {
                    throw {
                        name: "UnmatchedBrackets",
                        level: "TERMINAL",
                        message: "Unmatched ']' encountered in source code"
                    };
                }
                break;
            }
            case this.PRINT: {
                var c = String.fromCharCode(this.memory[this.memoryIdx]);
                // this.output += c;
                postMessage({ "command": "print", "value": c });
                break;
            }
            case this.READ: {
                if (this.inputIdx < this.input.length) {
                    this.memory[this.memoryIdx] = String.charCodeAt(this.input[this.inputIdx++]) % 256;
                }
                else {
                    this.memory[this.memoryIdx] = 0;
                    this._halt = true;
                    throw {
                        name: "EOF",
                        level: "PROCEDURAL"
                    };
                }
                break;
            }
            default:
                break;
        }
        count = 1;
        ++this.pc;
    } // End of while

    this.runTime += Date.now() - this.startTime;
    if (this.pc >= this.program.length) {
        this.fin(false);
    }
    else {
        setTimeout(this.run.bind(this), 1);
    }
}

Interpreter.prototype.run = function()
{
    try {
        this.step_run();
    }
    catch (err) {
        switch (err.level) {
            case "TERMINAL": {
                postMessage({ "command": "error", "message": err.message });
                this.fin(true);
                break;
            }
            case "PROCEDURAL": {
                if (err.name === "EOF") {
                    postMessage({ "command": "read" });
                }
                else if (err.name === "HaltInterpreter") {
                    this.fin(true);
                }
                break;
            }
            default:
                break;
        }
    }
}
/* ================== End of Core Interpreter ================ */


/* ================== Web Worker communication point ================ */

onmessage = function(event) 
{
    var data = event.data;

    switch (data.command) {
        case "run": {
            interpreter = new Interpreter(data.program, data.input, data.optimize);
            interpreter.run();
            break;
        }
        case "input": {
            interpreter.feedInput(data.input);
            // No break; Move on to resume
        }
        case "resume": {
            interpreter.unhalt();
            interpreter.run();
            break;
        }
        case "halt": {
            interpreter.halt();
            break;
        }
        default:
            break;
    }
};
/* ================== End of Web Worker communication point ================ */

var interpreter = null;

