import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";

let _provider: BasicTracerProvider | null = null;
let _inMemoryExporter: InMemorySpanExporter | null = null;

export async function initTracing(): Promise<void> {
    if (_provider) return;

    const otlpEndpoint = process.env.SOROKEEP_OTLP_ENDPOINT?.trim();
    const useInMemory = process.env.SOROKEEP_OTLP_IN_MEMORY?.trim() === "true";

    if (!otlpEndpoint && !useInMemory) {
        _provider = new BasicTracerProvider();
        return;
    }

    const spanProcessors: SpanProcessor[] = [];

    if (useInMemory) {
        _inMemoryExporter = new InMemorySpanExporter();
        spanProcessors.push(new SimpleSpanProcessor(_inMemoryExporter));
    }

    if (otlpEndpoint) {
        const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
        const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
        const exporter = new OTLPTraceExporter({ url: otlpEndpoint });
        spanProcessors.push(new BatchSpanProcessor(exporter));
    }

    _provider = new BasicTracerProvider({
        resource: resourceFromAttributes({
            "service.name": "sorokeep",
        }),
        spanProcessors,
    });
}

export function getTracer(): ReturnType<BasicTracerProvider["getTracer"]> {
    if (!_provider) {
        _provider = new BasicTracerProvider();
    }
    return _provider.getTracer("sorokeep", "1.0.0");
}

export function getInMemoryExporter(): InMemorySpanExporter | null {
    return _inMemoryExporter;
}

export async function shutdownTracing(): Promise<void> {
    if (_provider) {
        await _provider.shutdown();
        _provider = null;
        _inMemoryExporter = null;
    }
}

function safeSetError(span: Span, err: unknown): void {
    try {
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof Error) {
            span.recordException(err);
        }
    } catch {
        // defensive — OTEL API guarantees no throws, but guard per issue spec
    }
}

function safeEnd(span: Span): void {
    try {
        span.end();
    } catch {
        // defensive — OTEL API guarantees no throws, but guard per issue spec
    }
}

export function endSpan(span: Span, err?: unknown): void {
    if (err) {
        safeSetError(span, err);
    }
    safeEnd(span);
}

export async function withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
): Promise<T> {
    const tracer = getTracer();
    const span = tracer.startSpan(name);
    try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
    } catch (err) {
        safeSetError(span, err);
        throw err;
    } finally {
        safeEnd(span);
    }
}
