import './analytics-print.css';

export interface AnalyticsReportData {
    avgOverall: string;
    avgBus: string;
    avgUV: string;
    utilization: number;
    violations: number;
    violBus: number;
    violUV: number;
    peak: ReadonlyArray<{ time: string; volume: number }>;
    duration: ReadonlyArray<{ time: string; avgBus: number; avgUV: number }>;
}

export interface AnalyticsReportViolation {
    id: string;
    date: string;
    time: string;
    slot: number;
    vehicle: string;
    overstay: string;
}

interface ReportProps {
    period: string;
    data: AnalyticsReportData;
    violations: ReadonlyArray<AnalyticsReportViolation>;
    generatedAt: Date;
}

const number = (value: number) => value.toLocaleString('en-PH');
const compactTime = (value: string) => value.replace(':00', '');

function VolumeChart({ data }: { data: AnalyticsReportData['peak'] }) {
    const maximum = Math.max(1, ...data.map(point => point.volume));
    const roughStep = maximum / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const step = ([1, 2, 5, 10].find(value => value * magnitude >= roughStep) || 10) * magnitude;
    const ceiling = step * 4;
    const left = 46, right = 662, top = 24, bottom = 140;
    const slot = (right - left) / Math.max(data.length, 1);
    const barWidth = Math.min(42, slot * 0.6);
    const y = (value: number) => bottom - value / ceiling * (bottom - top);

    return <svg viewBox="0 0 680 178" role="img" aria-labelledby="report-volume-title report-volume-desc">
        <title id="report-volume-title">Sample vehicle volume by time</title>
        <desc id="report-volume-desc">Illustrative vehicle counts for the selected sample period. Values are not recorded terminal activity.</desc>
        <text x={left} y={11} className="report-axis-unit">Vehicles</text>
        {Array.from({ length: 5 }, (_, index) => index * step).map(value => <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="report-grid-line" />
            <text x={left - 8} y={y(value) + 4} textAnchor="end" className="report-axis-label">{number(value)}</text>
        </g>)}
        {data.map((point, index) => {
            const x = left + slot * (index + 0.5);
            return <g key={point.time}>
                <rect x={x - barWidth / 2} y={y(point.volume)} width={barWidth} height={bottom - y(point.volume)} fill="#17695c" />
                <text x={x} y={y(point.volume) - 5} textAnchor="middle" className="report-value-label">{number(point.volume)}</text>
                <text x={x} y={bottom + 20} textAnchor="middle" className="report-axis-label">{compactTime(point.time)}</text>
            </g>;
        })}
    </svg>;
}

function DurationChart({ data }: { data: AnalyticsReportData['duration'] }) {
    const maximum = Math.max(20, ...data.flatMap(point => [point.avgBus, point.avgUV]));
    const ceiling = Math.ceil(maximum / 5) * 5;
    const left = 46, right = 662, top = 23, bottom = 137;
    const x = (index: number) => left + (right - left) * index / Math.max(data.length - 1, 1);
    const y = (value: number) => bottom - value / ceiling * (bottom - top);
    const path = (key: 'avgBus' | 'avgUV') => data.map((point, index) => `${x(index)},${y(point[key])}`).join(' ');

    return <svg viewBox="0 0 680 185" role="img" aria-labelledby="report-duration-title report-duration-desc">
        <title id="report-duration-title">Sample loading duration by vehicle type</title>
        <desc id="report-duration-desc">Bus uses a solid line and circular points. UV Express uses a dashed line and square points. The dotted reference line represents an example 15-minute limit.</desc>
        <text x={left} y={11} className="report-axis-unit">Minutes</text>
        {Array.from({ length: ceiling / 5 + 1 }, (_, index) => index * 5).map(value => <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="report-grid-line" />
            <text x={left - 8} y={y(value) + 4} textAnchor="end" className="report-axis-label">{value}</text>
        </g>)}
        <line x1={left} x2={right} y1={y(15)} y2={y(15)} stroke="#9b4038" strokeWidth="1.5" strokeDasharray="2 4" />
        <polyline points={path('avgBus')} fill="none" stroke="#23364b" strokeWidth="2.3" />
        <polyline points={path('avgUV')} fill="none" stroke="#17695c" strokeWidth="2.3" strokeDasharray="7 4" />
        {data.map((point, index) => <g key={point.time}>
            <circle cx={x(index)} cy={y(point.avgBus)} r="3.3" fill="#23364b" />
            <rect x={x(index) - 3} y={y(point.avgUV) - 3} width="6" height="6" fill="#17695c" />
            <text x={x(index)} y={bottom + 19} textAnchor="middle" className="report-axis-label">{compactTime(point.time)}</text>
        </g>)}
        <g className="report-axis-label">
            <line x1="142" x2="167" y1="177" y2="177" stroke="#23364b" strokeWidth="2.3" /><circle cx="154" cy="177" r="3" fill="#23364b" />
            <text x="173" y="181">Bus</text>
            <line x1="226" x2="251" y1="177" y2="177" stroke="#17695c" strokeWidth="2.3" strokeDasharray="7 4" /><rect x="236" y="174" width="6" height="6" fill="#17695c" />
            <text x="257" y="181">UV Express</text>
            <line x1="377" x2="402" y1="177" y2="177" stroke="#9b4038" strokeWidth="1.5" strokeDasharray="2 4" />
            <text x="408" y="181">Example 15-minute limit</text>
        </g>
    </svg>;
}

function Masthead({ section }: { section: string }) {
    return <header className="report-masthead">
        <div><strong>TerminalSight</strong><span>Panabo City Bus Terminal</span></div>
        <span className="report-section-name">{section}</span>
    </header>;
}

function Footer({ page }: { page: number }) {
    return <footer className="report-footer">
        <span>TERMINALSIGHT / SAMPLE REPORT / NOT AN OPERATIONAL RECORD</span>
        <span>Page {page} of 2</span>
    </footer>;
}

export function AnalyticsPrintReport({ period, data, violations, generatedAt }: ReportProps) {
    const generated = new Intl.DateTimeFormat('en-PH', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'Asia/Manila',
    }).format(generatedAt);

    return <article className="analytics-print-report" aria-label="Sample analytics report">
        <section className="analytics-report-page">
            <Masthead section="Analytics / Overview" />
            <div className="report-title-block">
                <p className="report-eyebrow">Demonstration edition</p>
                <h1>Sample analytics report</h1>
                <p className="report-deck">A summary of illustrative terminal activity and reporting features.</p>
            </div>
            <dl className="report-metadata">
                <div><dt>Selected sample period</dt><dd>{period}</dd></div>
                <div><dt>Generated</dt><dd>{generated} <span>PHT (UTC+8)</span></dd></div>
            </dl>
            <div className="report-disclaimer"><strong>Sample data only.</strong> Values and charts are demonstration examples, not measurements of actual terminal activity or evidence of system performance.</div>
            <section className="report-section">
                <h2><span>01</span> Sample indicators</h2>
                <div className="report-indicators">
                    <div><h3>Average turnaround</h3><p className="report-indicator-value">{data.avgOverall}</p><p>Bus {data.avgBus} / UV Express {data.avgUV}</p></div>
                    <div><h3>Bay utilization</h3><p className="report-indicator-value">{data.utilization}<small>%</small></p><p>Illustrative utilization value</p></div>
                    <div><h3>Violations</h3><p className="report-indicator-value">{number(data.violations)}</p><p>Bus {number(data.violBus)} / UV Express {number(data.violUV)}</p></div>
                </div>
            </section>
            <section className="report-section report-chart-section">
                <h2><span>02</span> Vehicle volume by time</h2>
                <p className="report-section-intro">Example counts in the selected sample dataset.</p>
                <VolumeChart data={data.peak} />
            </section>
            <section className="report-section report-chart-section">
                <h2><span>03</span> Loading duration by vehicle type</h2>
                <p className="report-section-intro">Example average duration, in minutes; the reference limit is 15 minutes.</p>
                <DurationChart data={data.duration} />
            </section>
            <p className="report-endnote">Period names select example datasets. They do not identify a measured date range.</p>
            <Footer page={1} />
        </section>

        <section className="analytics-report-page">
            <Masthead section="Analytics / Example register" />
            <div className="report-title-block">
                <p className="report-eyebrow">Supporting examples</p>
                <h1>Sample violation register</h1>
                <p className="report-deck">Illustrative entries showing how a violation record is presented.</p>
            </div>
            <div className="report-register-summary"><strong>{violations.length} example entries</strong><span>Separate from the selected chart period: {period}</span></div>
            <table className="report-register">
                <colgroup><col style={{ width: '17%' }} /><col style={{ width: '26%' }} /><col style={{ width: '10%' }} /><col style={{ width: '25%' }} /><col style={{ width: '22%' }} /></colgroup>
                <thead><tr><th>Sample ID</th><th>Example date / time</th><th>Bay</th><th>Vehicle</th><th className="report-align-right">Overstay</th></tr></thead>
                <tbody>{violations.map(entry => <tr key={entry.id}>
                    <td className="report-record-id">{entry.id}</td>
                    <td>{entry.date}<span className="report-secondary-line">{entry.time}</span></td>
                    <td>{entry.slot}</td>
                    <td>{entry.vehicle}</td>
                    <td className="report-align-right report-record-id">{entry.overstay}</td>
                </tr>)}</tbody>
            </table>
            <p className="report-table-note">Dates, bay numbers and durations above are examples. These entries do not establish that any vehicle overstayed.</p>
            <section className="report-section report-scope-section">
                <h2><span>04</span> Scope and interpretation</h2>
                <dl className="report-scope-list">
                    <div><dt>Purpose</dt><dd>Demonstrate the report structure, charts and violation register for TerminalSight.</dd></div>
                    <div><dt>Sample values</dt><dd>The indicators and charts use the selected example dataset. The register uses a separate fixed list of example entries; it is not a breakdown of the violation total on page 1.</dd></div>
                    <div><dt>Current coverage</dt><dd>Camera coverage depends on healthy operational feeds. This example register is not evidence of current camera coverage.</dd></div>
                    <div><dt>Saved records</dt><dd>This report is separate from the saved occupancy CSV export. Recent camera detections may not appear in that export, which is not a complete terminal history.</dd></div>
                </dl>
            </section>
            <div className="report-closing-note"><span className="report-eyebrow">Use of this report</span><p>Suitable for demonstrating the reporting interface. Actual terminal performance and deployment results require verified operational data.</p></div>
            <Footer page={2} />
        </section>
    </article>;
}
