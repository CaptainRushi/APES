// APES Calculator - script.js

let currentInput = '0';
let hasDecimal = false;

const display = document.getElementById('display');

function updateDisplay() {
    display.value = currentInput;
}

function appendToDisplay(value) {
    if (value === '.' && hasDecimal) return;
    if (value === '.') hasDecimal = true;

    if (currentInput === '0' && value !== '.' && !'+-*/'.includes(value)) {
        currentInput = value;
    } else {
        // Reset decimal tracking when operator is pressed
        if ('+-*/'.includes(value)) hasDecimal = false;
        currentInput += value;
    }
    updateDisplay();
}

function clearDisplay() {
    currentInput = '0';
    hasDecimal = false;
    updateDisplay();
}

function deleteLast() {
    if (currentInput.length <= 1) {
        currentInput = '0';
        hasDecimal = false;
    } else {
        const removed = currentInput.slice(-1);
        if (removed === '.') hasDecimal = false;
        currentInput = currentInput.slice(0, -1);
    }
    updateDisplay();
}

function calculate() {
    try {
        // Sanitize: only allow digits, operators, decimal points, and spaces
        if (!/^[\d+\-*/.\s]+$/.test(currentInput)) {
            currentInput = 'Error';
            updateDisplay();
            return;
        }
        const result = Function('"use strict"; return (' + currentInput + ')')();
        if (!isFinite(result)) {
            currentInput = 'Error';
        } else {
            currentInput = String(result);
            hasDecimal = currentInput.includes('.');
        }
    } catch {
        currentInput = 'Error';
    }
    updateDisplay();
}

// Keyboard support
document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') appendToDisplay(e.key);
    else if (e.key === '.') appendToDisplay('.');
    else if (e.key === '+' || e.key === '-') appendToDisplay(e.key);
    else if (e.key === '*') appendToDisplay('*');
    else if (e.key === '/') appendToDisplay('/');
    else if (e.key === 'Enter' || e.key === '=') calculate();
    else if (e.key === 'Backspace') deleteLast();
    else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') clearDisplay();
});
