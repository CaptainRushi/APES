// Calculator JavaScript - Basic arithmetic operations and display logic

// Calculator state
let currentValue = '0';
let previousValue = '';
let operation = null;
let shouldResetDisplay = false;

// DOM Elements
const display = document.getElementById('display');

// Update the display
function updateDisplay() {
    display.textContent = currentValue;
}

// Handle number input
function inputNumber(num) {
    if (shouldResetDisplay) {
        currentValue = num;
        shouldResetDisplay = false;
    } else {
        if (currentValue === '0' && num !== '.') {
            currentValue = num;
        } else if (num === '.' && currentValue.includes('.')) {
            return; // Prevent multiple decimals
        } else {
            currentValue += num;
        }
    }
    updateDisplay();
}

// Handle operator input
function inputOperator(op) {
    if (operation !== null && !shouldResetDisplay) {
        calculate();
    }
    previousValue = currentValue;
    operation = op;
    shouldResetDisplay = true;
}

// Perform calculation
function calculate() {
    if (operation === null || shouldResetDisplay) {
        return;
    }
    
    const prev = parseFloat(previousValue);
    const current = parseFloat(currentValue);
    let result;
    
    switch (operation) {
        case '+':
            result = prev + current;
            break;
        case '-':
            result = prev - current;
            break;
        case '*':
            result = prev * current;
            break;
        case '/':
            if (current === 0) {
                currentValue = 'Error';
                operation = null;
                previousValue = '';
                shouldResetDisplay = true;
                updateDisplay();
                return;
            }
            result = prev / current;
            break;
        default:
            return;
    }
    
    // Handle floating point precision
    currentValue = parseFloat(result.toFixed(10)).toString();
    operation = null;
    previousValue = '';
    shouldResetDisplay = true;
    updateDisplay();
}

// Clear calculator
function clearCalculator() {
    currentValue = '0';
    previousValue = '';
    operation = null;
    shouldResetDisplay = false;
    updateDisplay();
}

// Delete last character
function deleteLastChar() {
    if (currentValue.length === 1 || currentValue === 'Error') {
        currentValue = '0';
    } else {
        currentValue = currentValue.slice(0, -1);
    }
    updateDisplay();
}

// Toggle positive/negative
function toggleSign() {
    if (currentValue !== '0' && currentValue !== 'Error') {
        if (currentValue.startsWith('-')) {
            currentValue = currentValue.slice(1);
        } else {
            currentValue = '-' + currentValue;
        }
        updateDisplay();
    }
}

// Calculate percentage
function calculatePercentage() {
    if (currentValue !== 'Error') {
        currentValue = (parseFloat(currentValue) / 100).toString();
        updateDisplay();
    }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Number buttons
    document.querySelectorAll('.number').forEach(button => {
        button.addEventListener('click', function() {
            inputNumber(this.dataset.value);
        });
    });
    
    // Operator buttons
    document.querySelectorAll('.operator').forEach(button => {
        button.addEventListener('click', function() {
            inputOperator(this.dataset.value);
        });
    });
    
    // Equals button
    document.querySelector('.equals').addEventListener('click', calculate);
    
    // Clear button
    document.querySelector('.clear').addEventListener('click', clearCalculator);
    
    // Delete button (if exists)
    const deleteBtn = document.querySelector('.delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteLastChar);
    }
    
    // Sign toggle button (if exists)
    const signBtn = document.querySelector('.sign');
    if (signBtn) {
        signBtn.addEventListener('click', toggleSign);
    }
    
    // Percentage button (if exists)
    const percentBtn = document.querySelector('.percent');
    if (percentBtn) {
        percentBtn.addEventListener('click', calculatePercentage);
    }
    
    // Keyboard support
    document.addEventListener('keydown', function(e) {
        if (e.key >= '0' && e.key <= '9') {
            inputNumber(e.key);
        } else if (e.key === '.') {
            inputNumber('.');
        } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
            inputOperator(e.key);
        } else if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault();
            calculate();
        } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
            clearCalculator();
        } else if (e.key === 'Backspace') {
            deleteLastChar();
        }
    });
    
    // Initial display update
    updateDisplay();
});
