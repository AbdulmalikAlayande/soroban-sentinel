declare module "parse-prometheus-text-format" {
    export interface PrometheusMetricSample {
        value: string;
        labels: Record<string, string>;
    }

    export interface PrometheusMetricFamily {
        name: string;
        help: string;
        type: string;
        metrics: PrometheusMetricSample[];
    }

    export default function parsePrometheusTextFormat(text: string): PrometheusMetricFamily[];
}
