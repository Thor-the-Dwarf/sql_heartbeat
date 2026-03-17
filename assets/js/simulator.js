/**
 * Simulator Engine
 * ----------------
 * Manages the execution state and step progression of the SQL simulation.
 * It takes a list of steps (produced by the Parser) and executes them one by one.
 */

class Simulator {
    constructor() {
        this.steps = [];
        this.currentStepIndex = -1;
        this.isPlaying = false;
        this.speed = 1000; // ms per step
        this.timer = null;

        // Event Hooks (can be overwritten by UI controller)
        this.onStepChange = (step, index) => console.log(`Step ${index}:`, step);
        this.onFinish = () => console.log('Simulation Finished');
    }

    loadSteps(steps) {
        this.steps = steps;
        this.currentStepIndex = -1;
        this.stop();
        console.log('Simulator: Steps loaded', this.steps);
    }

    start() {
        if (this.steps.length === 0) {
            console.warn('Simulator: No steps to run.');
            return;
        }
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.runNextStep();
    }

    stop() {
        this.isPlaying = false;
        clearTimeout(this.timer);
    }

    reset() {
        this.stop();
        this.currentStepIndex = -1;
        // Trigger UI reset if needed
    }

    runNextStep() {
        if (!this.isPlaying) return;

        this.currentStepIndex++;

        if (this.currentStepIndex >= this.steps.length) {
            this.finish();
            return;
        }

        const step = this.steps[this.currentStepIndex];
        this.onStepChange(step, this.currentStepIndex);

        // Schedule next step
        this.timer = setTimeout(() => {
            this.runNextStep();
        }, this.speed);
    }

    finish() {
        this.isPlaying = false;
        this.onFinish();
    }

    fastForward() {
        // Run all remaining steps immediately (or with minimal delay)
        this.stop();
        while (this.currentStepIndex < this.steps.length - 1) {
            this.currentStepIndex++;
            this.onStepChange(this.steps[this.currentStepIndex], this.currentStepIndex);
        }
        this.finish();
    }
}

// Export instance
window.simulator = new Simulator();
