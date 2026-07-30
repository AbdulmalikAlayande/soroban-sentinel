import { describe, it, expect } from "vitest";

// Async operations tests for comprehensive coverage
describe("Async Operations Coverage", () => {
    it("should handle promise chains with multiple branches", async () => {
        async function processData(input: any): Promise<{ result: string; steps: string[] }> {
            const steps: string[] = [];

            if (!input) {
                steps.push('null-check');
                return { result: 'empty', steps };
            }

            if (typeof input === 'string') {
                steps.push('string-processing');
                if (input.length > 10) {
                    steps.push('long-string');
                    return { result: input.slice(0, 10) + '...', steps };
                } else {
                    steps.push('short-string');
                    return { result: input.toUpperCase(), steps };
                }
            }

            if (typeof input === 'number') {
                steps.push('number-processing');
                if (input > 100) {
                    steps.push('large-number');
                    return { result: 'large', steps };
                } else if (input < 0) {
                    steps.push('negative-number');
                    return { result: 'negative', steps };
                } else {
                    steps.push('normal-number');
                    return { result: String(input), steps };
                }
            }

            if (Array.isArray(input)) {
                steps.push('array-processing');
                if (input.length === 0) {
                    steps.push('empty-array');
                    return { result: '[]', steps };
                } else {
                    steps.push('non-empty-array');
                    return { result: `[${input.length}]`, steps };
                }
            }

            steps.push('object-processing');
            return { result: 'object', steps };
        }

        expect(await processData(null)).toEqual({ result: 'empty', steps: ['null-check'] });
        expect(await processData('short')).toEqual({ result: 'SHORT', steps: ['string-processing', 'short-string'] });
        expect(await processData('this is a very long string')).toEqual({ 
            result: 'this is a ...', 
            steps: ['string-processing', 'long-string'] 
        });
        expect(await processData(150)).toEqual({ result: 'large', steps: ['number-processing', 'large-number'] });
        expect(await processData(-5)).toEqual({ result: 'negative', steps: ['number-processing', 'negative-number'] });
        expect(await processData(50)).toEqual({ result: '50', steps: ['number-processing', 'normal-number'] });
        expect(await processData([])).toEqual({ result: '[]', steps: ['array-processing', 'empty-array'] });
        expect(await processData([1, 2, 3])).toEqual({ result: '[3]', steps: ['array-processing', 'non-empty-array'] });
        expect(await processData({})).toEqual({ result: 'object', steps: ['object-processing'] });
    });

    it("should handle concurrent async operations", async () => {
        async function simulateAsyncTask(id: number, delay: number, shouldFail = false): Promise<{ id: number; duration: number }> {
            const start = Date.now();
            await new Promise(resolve => setTimeout(resolve, delay));
            
            if (shouldFail) {
                throw new Error(`Task ${id} failed`);
            }
            
            return { id, duration: Date.now() - start };
        }

        async function processTasksConcurrently(
            tasks: Array<{ id: number; delay: number; shouldFail?: boolean }>
        ): Promise<{ successful: any[]; failed: any[]; totalTime: number }> {
            const start = Date.now();
            const successful: any[] = [];
            const failed: any[] = [];

            const promises = tasks.map(async task => {
                try {
                    const result = await simulateAsyncTask(task.id, task.delay, task.shouldFail);
                    return { success: true, result };
                } catch (error) {
                    return { success: false, error: error.message, id: task.id };
                }
            });

            const results = await Promise.all(promises);
            
            for (const result of results) {
                if (result.success) {
                    successful.push(result.result);
                } else {
                    failed.push({ id: result.id, error: result.error });
                }
            }

            return {
                successful,
                failed,
                totalTime: Date.now() - start
            };
        }

        const tasks = [
            { id: 1, delay: 10 },
            { id: 2, delay: 20 },
            { id: 3, delay: 15, shouldFail: true },
            { id: 4, delay: 5 }
        ];

        const result = await processTasksConcurrently(tasks);
        
        expect(result.successful).toHaveLength(3);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toEqual({ id: 3, error: 'Task 3 failed' });
        expect(result.totalTime).toBeLessThan(100); // Should be concurrent, not sequential
    });

    it("should handle async iterators and generators", async () => {
        async function* asyncGenerator(count: number): AsyncGenerator<{ value: number; isEven: boolean }> {
            for (let i = 0; i < count; i++) {
                await new Promise(resolve => setTimeout(resolve, 1));
                
                const value = i + 1;
                const isEven = value % 2 === 0;
                
                if (value > 5 && value < 8) {
                    continue; // Skip 6, 7
                }
                
                yield { value, isEven };
                
                if (value >= 10) {
                    break;
                }
            }
        }

        async function processAsyncGenerator<T>(
            generator: AsyncGenerator<T>
        ): Promise<{ items: T[]; evenCount: number; oddCount: number }> {
            const items: T[] = [];
            let evenCount = 0;
            let oddCount = 0;

            for await (const item of generator) {
                items.push(item);
                
                if ('isEven' in item && typeof item.isEven === 'boolean') {
                    if (item.isEven) {
                        evenCount++;
                    } else {
                        oddCount++;
                    }
                }
            }

            return { items, evenCount, oddCount };
        }

        const result = await processAsyncGenerator(asyncGenerator(15));
        
        expect(result.items).toHaveLength(8); // 1,2,3,4,5,8,9,10 (6,7 skipped, stops at 10)
        expect(result.evenCount).toBe(4); // 2, 4, 8, 10
        expect(result.oddCount).toBe(4); // 1, 3, 5, 9
    });

    it("should handle async error recovery patterns", async () => {
        class AsyncTaskManager {
            private tasks = new Map<string, Promise<any>>();
            private results = new Map<string, any>();
            private errors = new Map<string, Error>();

            async executeWithFallback<T>(
                taskId: string,
                primaryTask: () => Promise<T>,
                fallbackTask?: () => Promise<T>,
                defaultValue?: T
            ): Promise<T> {
                try {
                    const result = await primaryTask();
                    this.results.set(taskId, result);
                    return result;
                } catch (primaryError) {
                    this.errors.set(`${taskId}_primary`, primaryError as Error);
                    
                    if (fallbackTask) {
                        try {
                            const fallbackResult = await fallbackTask();
                            this.results.set(taskId, fallbackResult);
                            return fallbackResult;
                        } catch (fallbackError) {
                            this.errors.set(`${taskId}_fallback`, fallbackError as Error);
                        }
                    }
                    
                    if (defaultValue !== undefined) {
                        this.results.set(taskId, defaultValue);
                        return defaultValue;
                    }
                    
                    throw primaryError;
                }
            }

            async executeWithTimeout<T>(
                taskId: string,
                task: () => Promise<T>,
                timeoutMs: number
            ): Promise<T> {
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Task timeout')), timeoutMs);
                });

                try {
                    const result = await Promise.race([task(), timeoutPromise]);
                    this.results.set(taskId, result);
                    return result;
                } catch (error) {
                    this.errors.set(taskId, error as Error);
                    throw error;
                }
            }

            getTaskStatus(taskId: string): { hasResult: boolean; hasError: boolean; result?: any; error?: Error } {
                return {
                    hasResult: this.results.has(taskId),
                    hasError: this.errors.has(taskId),
                    result: this.results.get(taskId),
                    error: this.errors.get(taskId)
                };
            }

            getAllErrors(): Array<{ taskId: string; error: Error }> {
                const allErrors: Array<{ taskId: string; error: Error }> = [];
                for (const [taskId, error] of this.errors.entries()) {
                    allErrors.push({ taskId, error });
                }
                return allErrors;
            }
        }

        const manager = new AsyncTaskManager();

        // Test successful primary task
        const result1 = await manager.executeWithFallback(
            'task1',
            async () => 'primary success',
            async () => 'fallback success',
            'default'
        );
        expect(result1).toBe('primary success');
        expect(manager.getTaskStatus('task1').hasResult).toBe(true);

        // Test fallback on primary failure
        const result2 = await manager.executeWithFallback(
            'task2',
            async () => { throw new Error('Primary failed'); },
            async () => 'fallback success',
            'default'
        );
        expect(result2).toBe('fallback success');
        expect(manager.getTaskStatus('task2_primary').hasError).toBe(true);

        // Test default value on both failures
        const result3 = await manager.executeWithFallback(
            'task3',
            async () => { throw new Error('Primary failed'); },
            async () => { throw new Error('Fallback failed'); },
            'default value'
        );
        expect(result3).toBe('default value');

        // Test timeout
        await expect(manager.executeWithTimeout(
            'timeout-task',
            async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 'should not reach';
            },
            50
        )).rejects.toThrow('Task timeout');

        const errors = manager.getAllErrors();
        expect(errors.length).toBeGreaterThan(0);
    });

    it("should handle complex async state management", async () => {
        type State = 'idle' | 'loading' | 'success' | 'error' | 'cancelled';
        
        class AsyncStateMachine {
            private state: State = 'idle';
            private data: any = null;
            private error: Error | null = null;
            private cancelToken: { cancelled: boolean } = { cancelled: false };

            async execute<T>(
                operation: (cancelToken: { cancelled: boolean }) => Promise<T>
            ): Promise<{ state: State; data?: T; error?: Error }> {
                if (this.state === 'loading') {
                    throw new Error('Operation already in progress');
                }

                this.state = 'loading';
                this.data = null;
                this.error = null;
                this.cancelToken = { cancelled: false };

                try {
                    // Simulate some processing time
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    if (this.cancelToken.cancelled) {
                        this.state = 'cancelled';
                        return { state: this.state };
                    }

                    const result = await operation(this.cancelToken);
                    
                    if (this.cancelToken.cancelled) {
                        this.state = 'cancelled';
                        return { state: this.state };
                    }

                    this.state = 'success';
                    this.data = result;
                    return { state: this.state, data: result };
                } catch (error) {
                    if (this.cancelToken.cancelled) {
                        this.state = 'cancelled';
                        return { state: this.state };
                    }

                    this.state = 'error';
                    this.error = error as Error;
                    return { state: this.state, error: this.error };
                }
            }

            cancel(): void {
                if (this.state === 'loading') {
                    this.cancelToken.cancelled = true;
                }
            }

            reset(): void {
                this.state = 'idle';
                this.data = null;
                this.error = null;
                this.cancelToken = { cancelled: false };
            }

            getState(): { state: State; data: any; error: Error | null } {
                return {
                    state: this.state,
                    data: this.data,
                    error: this.error
                };
            }
        }

        const machine = new AsyncStateMachine();

        // Test successful execution
        const result1 = await machine.execute(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return 'success data';
        });
        expect(result1).toEqual({ state: 'success', data: 'success data' });

        // Reset and test error
        machine.reset();
        const result2 = await machine.execute(async () => {
            throw new Error('Operation failed');
        });
        expect(result2.state).toBe('error');
        expect(result2.error?.message).toBe('Operation failed');

        // Test cancellation
        machine.reset();
        const executePromise = machine.execute(async (cancelToken) => {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (cancelToken.cancelled) return 'cancelled';
            return 'should not reach';
        });

        // Cancel after a short delay
        setTimeout(() => machine.cancel(), 25);
        
        const result3 = await executePromise;
        expect(result3.state).toBe('cancelled');
    });
});