import { describe, it, expect } from "vitest";

// Configuration validation tests
describe("Configuration Validation Coverage", () => {
    it("should validate database configuration", () => {
        interface DatabaseConfig {
            host?: string;
            port?: number;
            database?: string;
            username?: string;
            password?: string;
            ssl?: boolean;
            poolSize?: number;
        }

        function validateDatabaseConfig(config: any): { valid: boolean; errors: string[] } {
            const errors: string[] = [];

            if (!config) {
                errors.push('Configuration is required');
                return { valid: false, errors };
            }

            if (!config.host || typeof config.host !== 'string') {
                errors.push('Host is required and must be a string');
            } else if (config.host.length === 0) {
                errors.push('Host cannot be empty');
            }

            if (config.port !== undefined) {
                if (typeof config.port !== 'number') {
                    errors.push('Port must be a number');
                } else if (config.port < 1 || config.port > 65535) {
                    errors.push('Port must be between 1 and 65535');
                }
            }

            if (!config.database || typeof config.database !== 'string') {
                errors.push('Database name is required and must be a string');
            }

            if (config.username && typeof config.username !== 'string') {
                errors.push('Username must be a string');
            }

            if (config.password && typeof config.password !== 'string') {
                errors.push('Password must be a string');
            }

            if (config.ssl !== undefined && typeof config.ssl !== 'boolean') {
                errors.push('SSL must be a boolean');
            }

            if (config.poolSize !== undefined) {
                if (typeof config.poolSize !== 'number') {
                    errors.push('Pool size must be a number');
                } else if (config.poolSize < 1 || config.poolSize > 100) {
                    errors.push('Pool size must be between 1 and 100');
                }
            }

            return { valid: errors.length === 0, errors };
        }

        // Valid config
        const validConfig = {
            host: 'localhost',
            port: 5432,
            database: 'testdb',
            username: 'user',
            password: 'pass',
            ssl: true,
            poolSize: 10
        };
        expect(validateDatabaseConfig(validConfig)).toEqual({ valid: true, errors: [] });

        // Invalid configs
        expect(validateDatabaseConfig(null)).toEqual({
            valid: false,
            errors: ['Configuration is required']
        });

        expect(validateDatabaseConfig({ host: '', database: 'test' })).toEqual({
            valid: false,
            errors: ['Host is required and must be a string']
        });

        expect(validateDatabaseConfig({ host: 'localhost', port: 70000 })).toEqual({
            valid: false,
            errors: ['Port must be between 1 and 65535', 'Database name is required and must be a string']
        });

        expect(validateDatabaseConfig({ host: 'localhost', database: 'test', poolSize: 0 })).toEqual({
            valid: false,
            errors: ['Pool size must be between 1 and 100']
        });
    });

    it("should validate alert configuration", () => {
        interface AlertConfig {
            enabled?: boolean;
            channels?: Array<{
                type: 'slack' | 'webhook' | 'email';
                config: any;
            }>;
            rules?: Array<{
                event: string;
                severity: 'info' | 'warning' | 'error';
                channels: string[];
            }>;
        }

        function validateAlertConfig(config: any): { valid: boolean; errors: string[] } {
            const errors: string[] = [];

            if (!config) {
                return { valid: true, errors: [] }; // Alert config is optional
            }

            if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
                errors.push('Enabled must be a boolean');
            }

            if (config.channels) {
                if (!Array.isArray(config.channels)) {
                    errors.push('Channels must be an array');
                } else {
                    config.channels.forEach((channel, index) => {
                        if (!channel.type || !['slack', 'webhook', 'email'].includes(channel.type)) {
                            errors.push(`Channel ${index}: type must be slack, webhook, or email`);
                        }

                        if (!channel.config) {
                            errors.push(`Channel ${index}: config is required`);
                        } else {
                            if (channel.type === 'slack' && !channel.config.webhookUrl) {
                                errors.push(`Channel ${index}: Slack config requires webhookUrl`);
                            }
                            if (channel.type === 'webhook' && !channel.config.url) {
                                errors.push(`Channel ${index}: Webhook config requires url`);
                            }
                            if (channel.type === 'email' && (!channel.config.to || !channel.config.from)) {
                                errors.push(`Channel ${index}: Email config requires to and from`);
                            }
                        }
                    });
                }
            }

            if (config.rules) {
                if (!Array.isArray(config.rules)) {
                    errors.push('Rules must be an array');
                } else {
                    config.rules.forEach((rule, index) => {
                        if (!rule.event || typeof rule.event !== 'string') {
                            errors.push(`Rule ${index}: event is required and must be a string`);
                        }

                        if (!rule.severity || !['info', 'warning', 'error'].includes(rule.severity)) {
                            errors.push(`Rule ${index}: severity must be info, warning, or error`);
                        }

                        if (!rule.channels || !Array.isArray(rule.channels)) {
                            errors.push(`Rule ${index}: channels is required and must be an array`);
                        }
                    });
                }
            }

            return { valid: errors.length === 0, errors };
        }

        // Valid config
        const validConfig = {
            enabled: true,
            channels: [
                {
                    type: 'slack' as const,
                    config: { webhookUrl: 'https://hooks.slack.com/...' }
                },
                {
                    type: 'webhook' as const,
                    config: { url: 'https://api.example.com/webhook' }
                }
            ],
            rules: [
                {
                    event: 'system_error',
                    severity: 'error' as const,
                    channels: ['slack']
                }
            ]
        };
        expect(validateAlertConfig(validConfig)).toEqual({ valid: true, errors: [] });

        // Empty config is valid
        expect(validateAlertConfig(null)).toEqual({ valid: true, errors: [] });

        // Invalid configs
        expect(validateAlertConfig({ enabled: 'yes' })).toEqual({
            valid: false,
            errors: ['Enabled must be a boolean']
        });

        expect(validateAlertConfig({ channels: 'not-array' })).toEqual({
            valid: false,
            errors: ['Channels must be an array']
        });

        expect(validateAlertConfig({
            channels: [{ type: 'invalid', config: {} }]
        })).toEqual({
            valid: false,
            errors: ['Channel 0: type must be slack, webhook, or email']
        });

        expect(validateAlertConfig({
            channels: [{ type: 'slack', config: {} }]
        })).toEqual({
            valid: false,
            errors: ['Channel 0: Slack config requires webhookUrl']
        });
    });

    it("should validate environment configurations", () => {
        function validateEnvironment(env: any): { valid: boolean; errors: string[] } {
            const errors: string[] = [];

            if (!env) {
                errors.push('Environment configuration is required');
                return { valid: false, errors };
            }

            const requiredVars = ['NODE_ENV', 'DATABASE_URL', 'PORT'];
            const optionalVars = ['LOG_LEVEL', 'RATE_LIMIT', 'SESSION_SECRET'];

            for (const varName of requiredVars) {
                if (!env[varName]) {
                    errors.push(`${varName} is required`);
                } else if (typeof env[varName] !== 'string') {
                    errors.push(`${varName} must be a string`);
                }
            }

            // Validate NODE_ENV
            if (env.NODE_ENV && !['development', 'production', 'test'].includes(env.NODE_ENV)) {
                errors.push('NODE_ENV must be development, production, or test');
            }

            // Validate PORT
            if (env.PORT) {
                const port = parseInt(env.PORT, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    errors.push('PORT must be a valid port number');
                }
            }

            // Validate LOG_LEVEL if present
            if (env.LOG_LEVEL && !['debug', 'info', 'warn', 'error'].includes(env.LOG_LEVEL)) {
                errors.push('LOG_LEVEL must be debug, info, warn, or error');
            }

            // Validate DATABASE_URL format
            if (env.DATABASE_URL && !env.DATABASE_URL.startsWith('postgresql://')) {
                errors.push('DATABASE_URL must be a PostgreSQL connection string');
            }

            return { valid: errors.length === 0, errors };
        }

        // Valid environment
        const validEnv = {
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
            PORT: '3000',
            LOG_LEVEL: 'info'
        };
        expect(validateEnvironment(validEnv)).toEqual({ valid: true, errors: [] });

        // Missing required variables
        expect(validateEnvironment({})).toEqual({
            valid: false,
            errors: ['NODE_ENV is required', 'DATABASE_URL is required', 'PORT is required']
        });

        // Invalid values
        expect(validateEnvironment({
            NODE_ENV: 'invalid',
            DATABASE_URL: 'invalid-url',
            PORT: 'invalid-port',
            LOG_LEVEL: 'verbose'
        })).toEqual({
            valid: false,
            errors: [
                'NODE_ENV must be development, production, or test',
                'PORT must be a valid port number',
                'LOG_LEVEL must be debug, info, warn, or error',
                'DATABASE_URL must be a PostgreSQL connection string'
            ]
        });
    });

    it("should validate nested configuration objects", () => {
        interface AppConfig {
            app: {
                name: string;
                version: string;
            };
            server: {
                host: string;
                port: number;
            };
            features: {
                auth: boolean;
                metrics: boolean;
                logging: {
                    level: string;
                    format: string;
                };
            };
        }

        function validateAppConfig(config: any): { valid: boolean; errors: string[] } {
            const errors: string[] = [];

            if (!config) {
                errors.push('Configuration is required');
                return { valid: false, errors };
            }

            // Validate app section
            if (!config.app) {
                errors.push('App configuration is required');
            } else {
                if (!config.app.name || typeof config.app.name !== 'string') {
                    errors.push('App name is required and must be a string');
                }
                if (!config.app.version || typeof config.app.version !== 'string') {
                    errors.push('App version is required and must be a string');
                }
            }

            // Validate server section
            if (!config.server) {
                errors.push('Server configuration is required');
            } else {
                if (!config.server.host || typeof config.server.host !== 'string') {
                    errors.push('Server host is required and must be a string');
                }
                if (!config.server.port || typeof config.server.port !== 'number') {
                    errors.push('Server port is required and must be a number');
                }
            }

            // Validate features section
            if (!config.features) {
                errors.push('Features configuration is required');
            } else {
                if (typeof config.features.auth !== 'boolean') {
                    errors.push('Features auth must be a boolean');
                }
                if (typeof config.features.metrics !== 'boolean') {
                    errors.push('Features metrics must be a boolean');
                }
                if (!config.features.logging) {
                    errors.push('Features logging configuration is required');
                } else {
                    if (!config.features.logging.level || typeof config.features.logging.level !== 'string') {
                        errors.push('Logging level is required and must be a string');
                    }
                    if (!config.features.logging.format || typeof config.features.logging.format !== 'string') {
                        errors.push('Logging format is required and must be a string');
                    }
                }
            }

            return { valid: errors.length === 0, errors };
        }

        // Valid config
        const validConfig = {
            app: {
                name: 'MyApp',
                version: '1.0.0'
            },
            server: {
                host: 'localhost',
                port: 3000
            },
            features: {
                auth: true,
                metrics: false,
                logging: {
                    level: 'info',
                    format: 'json'
                }
            }
        };
        expect(validateAppConfig(validConfig)).toEqual({ valid: true, errors: [] });

        // Missing sections
        expect(validateAppConfig({})).toEqual({
            valid: false,
            errors: [
                'App configuration is required',
                'Server configuration is required',
                'Features configuration is required'
            ]
        });

        // Partial invalid config
        expect(validateAppConfig({
            app: { name: 'Test' }, // missing version
            server: { host: 'localhost' }, // missing port
            features: { auth: 'yes', logging: {} } // wrong type, missing fields
        })).toEqual({
            valid: false,
            errors: [
                'App version is required and must be a string',
                'Server port is required and must be a number',
                'Features auth must be a boolean',
                'Features metrics must be a boolean',
                'Logging level is required and must be a string',
                'Logging format is required and must be a string'
            ]
        });
    });
});