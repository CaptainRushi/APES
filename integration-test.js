import { AgentLoop } from './src/agents/agent-loop.js';
import { ProviderRouter } from './src/providers/provider-router.js';
import { writeFileSync, existsSync, unlinkSync } from 'fs';

async function runTest() {
    console.log('--- STARTING FILE CREATION TEST ---');

    const provider = new ProviderRouter();

    // Create an objective that forces file creation
    const objective = "This is a mandatory test. You must create a file called 'forced-test.html' containing exactly '<h1>IT WORKS</h1>' and you must use the write_file tool. Do nothing else. Call task_complete afterward.";

    const loop = new AgentLoop('test-123', 'engineering', provider);

    // Intercept LLM calls to see EXACTLY what is returned
    const originalCallLLM = loop._callLLM.bind(loop);
    loop._callLLM = async () => {
        const res = await originalCallLLM();
        console.log('\n--- LLM RAW RESPONSE ---');
        console.log(res);
        console.log('------------------------\n');
        return res;
    };

    const result = await loop.run(objective);

    console.log('\n--- FINAL RESULT ---');
    console.log('Output:', result.output);
    console.log('Files tracked written:', result.filesWritten);

    if (existsSync('forced-test.html')) {
        console.log('✅ PASS: forced-test.html was ACTUALLY created on disk!');
        unlinkSync('forced-test.html');
    } else {
        console.log('❌ FAIL: forced-test.html was NOT found on disk.');
    }
}

runTest().catch(console.error);
