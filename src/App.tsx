/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, ReactNode, useRef } from 'react';
import { 
  TrendingUp, 
  Home, 
  PieChart as PieChartIcon, 
  ArrowRightLeft, 
  Info, 
  DollarSign, 
  Calendar, 
  Percent,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Briefcase,
  AlertTriangle,
  FileText,
  Activity,
  Download
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  Legend,
  Cell,
  ReferenceLine,
  Label
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// --- Types ---

interface FinancialDataPoint {
  year: number;
  propValue: number;
  loanBalance: number;
  netEquity: number;
  altValue: number;
  cumInterest: number;
  monthlyRent: number;
  monthlyOwnerCost: number;
}

interface CashFlowPoint {
  year: number;
  reCashFlow: number; // Negative (EMI - Rent)
  altCashFlow: number; // 0 or potential savings if RE costs > Alt
}

type InvestmentType = 'Alternate Investment';

// --- Utilities ---

const formatIndianNumber = (num: number, decimals: number = 0) => {
  const parts = num.toFixed(decimals).split('.');
  let x = Math.abs(parseInt(parts[0])).toString();
  let lastThree = x.substring(x.length - 3);
  const otherNumbers = x.substring(0, x.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const intPart = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  const res = num < 0 ? `-${intPart}` : intPart;
  
  return parts.length > 1 && decimals > 0 ? `${res}.${parts[1]}` : res;
};

const formatCurrency = (val: number) => `₹${formatIndianNumber(val, 0)}`;

const formatPercent = (val: number) => 
  new Intl.NumberFormat('en-IN', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

const getLakCrLabel = (val: number) => {
  if (val >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(2)} Lakh`;
  return formatCurrency(val);
};

// --- Components ---

export default function App() {
  // --- REAL ESTATE INPUTS ---
  const [downPayment, setDownPayment] = useState<number>(100000);
  const [loanAmount, setLoanAmount] = useState<number>(400000);
  const [interestRate, setInterestRate] = useState<number>(6.5);
  const [loanDuration, setLoanDuration] = useState<number>(30);
  const [appreciationRate, setAppreciationRate] = useState<number>(3.5);
  const [monthlyRent, setMonthlyRent] = useState<number>(0);
  const [rentEscalation, setRentEscalation] = useState<number>(5.0);
  const [maintenanceRate, setMaintenanceRate] = useState<number>(0.8);

  // --- ALTERNATIVE INVESTMENT INPUTS ---
  const [altROI, setAltROI] = useState<number>(9.5);
  const [invType, setInvType] = useState<InvestmentType>('Alternate Investment');
  const [selectedTaxRate, setSelectedTaxRate] = useState<number>(0);

  const calculateTaxOnGains = (gains: number, rate: number) => {
    // Strictly voluntary: If rate is 0, tax is 0. 
    // If rate is selected, it applies to the total gains.
    return (gains * rate) / 100;
  };

  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState<'charts' | 'tables'>('charts');
  const [expandedTable, setExpandedTable] = useState<'re' | 'alt' | 'summary' | null>(null);

  // --- CALCULATIONS ---

  const propertyPrice = downPayment + loanAmount;

  const results = useMemo(() => {
    const r = interestRate / 100 / 12;
    const n = loanDuration * 12;
    
    // Standard Amortization EMI
    const emi = loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    
    // Time Series Data - WE NOW PROJECT FOR A FIXED 40 YEARS TO SEE POST-LOAN BENEFITS
    const projectionYears = 40;
    const yearlyData: FinancialDataPoint[] = [];
    const cashFlowData: CashFlowPoint[] = [];

    let currentLoanBalance = loanAmount;
    let currentPropValue = propertyPrice;
    let currentAltValue = downPayment; 
    let currentMonthlyRent = monthlyRent;
    let totalInterestPaid = 0;
    let totalInvestedInB = downPayment; // TRACK COST BASIS FOR ACCURATE TAX
    let crossoverYear: number | null = null;

    // Start at Year 0
    yearlyData.push({
      year: 0,
      propValue: currentPropValue,
      loanBalance: currentLoanBalance,
      netEquity: currentPropValue - currentLoanBalance,
      altValue: currentAltValue,
      cumInterest: 0,
      monthlyRent: monthlyRent,
      monthlyOwnerCost: emi + ((currentPropValue * (maintenanceRate / 100)) / 12)
    });

    for (let y = 1; y <= projectionYears; y++) {
      // Internal monthly loop for precision (SIP and Amortization)
      for (let m = 1; m <= 12; m++) {
        // 1. RE Value Appreciation (monthly compounding)
        currentPropValue *= Math.pow(1 + appreciationRate / 100, 1 / 12);
        
        // 2. Loan Interest and Principal (Only if loan is active)
        if (y <= loanDuration) {
          const interestForMonth = currentLoanBalance * r;
          const principalForMonth = emi - interestForMonth;
          currentLoanBalance = Math.max(0, currentLoanBalance - principalForMonth);
          totalInterestPaid += interestForMonth;
        } else {
          currentLoanBalance = 0;
        }

        // 3. Maintenance Cost (Annual % / 12)
        const monthlyMaintenance = (currentPropValue * (maintenanceRate / 100)) / 12;
        
        // 4. Alt Strategy growth
        currentAltValue *= Math.pow(1 + altROI / 100, 1 / 12);
        
        // 5. Monthly Outflow Comparison
        // Scenario A outflow = EMI (if active) + Maintenance
        const scenarioAOutflow = (y <= loanDuration ? emi : 0) + monthlyMaintenance;
        // Scenario B outflow = Rent
        const scenarioBOutflow = currentMonthlyRent;
        
        const savingInB = scenarioAOutflow - scenarioBOutflow;
        
        if (savingInB < 0 && crossoverYear === null) {
          crossoverYear = y;
        }

        // Apply SIP/Withdrawal
        currentAltValue += savingInB;
        // Only track as "Investment" if we are actually putting money IN, not taking out
        if (savingInB > 0) {
          totalInvestedInB += savingInB;
        }
      }
      
      // End of year rent escalation
      currentMonthlyRent *= (1 + rentEscalation/100);

      const ownerCostYearly = (y <= loanDuration ? emi : 0) + ((currentPropValue * (maintenanceRate / 100)) / 12);

      yearlyData.push({
        year: y,
        propValue: currentPropValue,
        loanBalance: currentLoanBalance,
        netEquity: currentPropValue - currentLoanBalance,
        altValue: currentAltValue,
        cumInterest: totalInterestPaid,
        monthlyRent: currentMonthlyRent,
        monthlyOwnerCost: ownerCostYearly
      });

      // Annual Cash Flow logging
      cashFlowData.push({
        year: y,
        reCashFlow: -((y <= loanDuration ? emi : 0) * 12) - (currentPropValue * (maintenanceRate / 100)) + (currentMonthlyRent * 12),
        altCashFlow: 0
      });
    }

    // Results summary...
    const totalEmiPaid = emi * (loanDuration * 12);
    const totalInterest = totalInterestPaid;
    const reFinalNetWorth = yearlyData[yearlyData.length - 1].netEquity;
    
    // Apply Tax if required
    let finalAltWealthRaw = yearlyData[yearlyData.length - 1].altValue;
    let taxDeducted = 0;
    const gains = finalAltWealthRaw - totalInvestedInB; // FIXED: Cost Basis uses Cumulative principal
    if (gains > 0) {
      taxDeducted = calculateTaxOnGains(gains, selectedTaxRate);
    }
    const finalAltWealth = finalAltWealthRaw - taxDeducted;

    // ROI needs to be CAGR based on total effective cost for comparison over projection period
    const reXIRR = (Math.pow(reFinalNetWorth / (downPayment + totalInterestPaid + loanAmount), 1 / projectionYears) - 1) * 100;

    return {
      emi,
      totalInterest,
      totalEmiPaid,
      yearlyData,
      cashFlowData,
      reXIRR: reXIRR,
      altXIRR: altROI,
      taxDeducted,
      finalAltWealth,
      reFinalNetWealth: reFinalNetWorth,
      finalWealthDiff: reFinalNetWorth - finalAltWealth,
      winnerWealth: reFinalNetWorth > finalAltWealth ? reFinalNetWorth : finalAltWealth,
      reMultiplier: reFinalNetWorth / downPayment,
      altMultiplier: finalAltWealth / totalInvestedInB,
      crossoverYear
    };
  }, [downPayment, loanAmount, interestRate, loanDuration, appreciationRate, monthlyRent, altROI, propertyPrice, selectedTaxRate, rentEscalation, maintenanceRate]);

  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleDownloadPDF = async () => {
    // We target a specific hidden element for clear PDF capture
    const element = document.getElementById('pdf-report-container');
    if (!element) return;
    setIsExporting(true);
    
    // Briefly force visibility for capture
    element.style.display = 'block';
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';
    element.style.width = '800px'; // Consistent width for report
    element.style.zIndex = '-9999';

    try {
      // Small delay to ensure charts render if they were hidden
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0F172A',
        logging: false,
        windowWidth: 800
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [600, (canvas.height * 600) / canvas.width]
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Investment_Report_${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('PDF generation failed:', error);
    } finally {
      element.style.display = 'none';
      setIsExporting(false);
    }
  };

  const costBreakdownData = [
    {
      name: 'Real Estate',
      'Down Payment': downPayment,
      'Principal Repaid': loanAmount,
      'Interest Paid': results.totalInterest,
      'Appreciation': results.yearlyData[results.yearlyData.length - 1].propValue - propertyPrice,
    },
    {
      name: 'Alternative',
      'Initial Capital': propertyPrice,
      'Investment Returns': results.yearlyData[results.yearlyData.length - 1].altValue - propertyPrice,
      'Down Payment': 0, // for stacking alignment
      'Principal Repaid': 0,
      'Interest Paid': 0,
      'Appreciation': 0,
    }
  ];

  const getRiskScore = (roi: number) => {
    if (roi <= 7) return { text: 'Conservative', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (roi <= 11) return { text: 'Moderate', color: 'text-amber-400', bg: 'bg-amber-500/20' };
    return { text: 'Aggressive', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  return (
    <div ref={reportRef} className="min-h-screen bg-[#0F172A] text-primary-text font-sans selection:bg-alt selection:text-white">
      {/* --- TOP INPUT SECTION --- */}
      <div className="bg-[#0F172A] border-b border-border-color mb-8">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
          <header className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-border-color/50 pb-8 mb-8">
            <div className="flex-1">
              <h1 className="text-3xl md:text-5xl font-black tracking-tighter leading-none uppercase text-primary-text">
                EstateWealth <span className="text-transparent" style={{ WebkitTextStroke: '1.5px #378ADD' }}>Analyzer</span>
              </h1>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={handleDownloadPDF}
                disabled={isExporting}
                className="flex items-center gap-2 bg-alt hover:bg-alt-light text-white px-6 py-3 rounded-sm font-black uppercase text-xs tracking-[0.2em] transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-lg shadow-alt/20"
              >
                {isExporting ? (
                  <>Generating...</>
                ) : (
                  <>
                    <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                    Export Report (PDF)
                  </>
                )}
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* RE Inputs */}
            <div className="bg-success-dark/20 border-l-4 border-re p-6 shadow-xl border border-border-color rounded-r-md">
                <div className="flex items-center gap-2 mb-6">
                  <Home className="text-re w-5 h-5" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-re-light">Scenario A: Home Purchase</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <SliderInput label="Down Payment" value={downPayment} onChange={setDownPayment} min={100000} max={10000000} step={50000} isCurrency />
                  <SliderInput label="Loan Amount" value={loanAmount} onChange={setLoanAmount} min={100000} max={50000000} step={100000} isCurrency />
                  <SliderInput label="Interest Rate" value={interestRate} onChange={setInterestRate} min={1} max={15} step={0.05} suffix="%" />
                  <SliderInput label="Loan Years" value={loanDuration} onChange={setLoanDuration} min={1} max={30} step={1} />
                  <SliderInput label="Price Growth (%)" value={appreciationRate} onChange={setAppreciationRate} min={0} max={15} step={0.1} suffix="%" />
                  <SliderInput 
                    label="Monthly Rent" 
                    value={monthlyRent} 
                    onChange={setMonthlyRent} 
                    min={0} 
                    max={200000} 
                    step={1000} 
                    isCurrency 
                    subLabel="Current market rent for similar property."
                  />
                  <SliderInput 
                    label="Rent Escalation (%)" 
                    value={rentEscalation} 
                    onChange={setRentEscalation} 
                    min={0} 
                    max={20} 
                    step={0.1} 
                    suffix="%" 
                    subLabel="India Average: 5 - 8% yearly."
                  />
                  <SliderInput 
                    label="Maint. & Taxes (%)" 
                    value={maintenanceRate} 
                    onChange={setMaintenanceRate} 
                    min={0} 
                    max={5} 
                    step={0.1} 
                    suffix="%" 
                    subLabel="India Average: 0.5 - 1.2% of value."
                  />
                </div>
            </div>

            {/* Alt Inputs */}
            <div className="bg-alt-dark/20 border-l-4 border-alt p-6 shadow-xl border border-border-color rounded-r-md">
                <div className="flex items-center gap-2 mb-6">
                  <TrendingUp className="text-alt w-5 h-5" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-alt-light">Scenario B: alternative investment</h2>
                </div>
                <div className="space-y-8">
                  <SliderInput label="Investment Returns (ROI %)" value={altROI} onChange={setAltROI} min={1} max={30} step={0.01} suffix="%" />
                  
                  <div className="space-y-3">
                    <label className="text-xs uppercase font-bold text-secondary-text tracking-widest">Select Capital Gains Tax Slab</label>
                    <select 
                      value={selectedTaxRate}
                      onChange={(e) => setSelectedTaxRate(Number(e.target.value))}
                      className="w-full bg-input-bg border border-border-color rounded-md px-3 py-2.5 text-base font-black text-primary-text outline-none focus:border-alt transition-colors appearance-none cursor-pointer"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2394A3B8\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'%3E%3C/path%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1.25rem' }}
                    >
                      <option value={0}>No Tax (0%)</option>
                      <option value={5}>5% Slab</option>
                      <option value={10}>10% Slab</option>
                      <option value={12.5}>12.5% (LTCG - Equity)</option>
                      <option value={15}>15% Slab</option>
                      <option value={20}>20% Slab</option>
                      <option value={25}>25% Slab</option>
                      <option value={30}>30% Slab</option>
                    </select>
                    <p className="text-[10px] text-highlight font-bold uppercase leading-tight mt-1 opacity-80">
                      {selectedTaxRate === 0 
                        ? "Zero Tax Selected: All gains in Scenario B are tax-free."
                        : `Applying ${selectedTaxRate}% tax on the total profit of Scenario B.`
                      }
                    </p>
                  </div>

                  <div className="p-6 bg-input-bg rounded-sm border border-border-color flex items-center justify-between shadow-inner">
                      <div>
                        <p className="text-xs uppercase text-secondary-text font-bold mb-1">Starting Investment (B)</p>
                        <p className="text-2xl font-black text-primary-text">{formatCurrency(downPayment)}</p>
                        <p className="text-[10px] text-tertiary-text uppercase font-bold mt-1">Equal to Home Down Payment</p>
                      </div>
                      <div className="text-right">
                         <p className="text-xs uppercase text-secondary-text font-bold mb-1">Total Property Value</p>
                         <p className="text-sm font-bold text-alt-light uppercase">{getLakCrLabel(propertyPrice)}</p>
                      </div>
                  </div>
                </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        {/* The Header was moved to the fixed section */}

        {/* --- SUMMARY METRICS --- */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
           <MetricCard label="Monthly EMI (Home Loan)" value={formatCurrency(results.emi)} sub={`Total paid for Loan: ${formatCurrency(results.totalEmiPaid)}`} color="#E24B4A" />
           <MetricCard label="Profit Difference" value={formatCurrency(Math.abs(results.finalWealthDiff))} sub={results.finalWealthDiff > 0 ? "Advantage: Home Investment" : "Advantage: Alternate Investment"} color={results.finalWealthDiff > 0 ? "#639922" : "#378ADD"} />
           <MetricCard label="Total Interest Cost" value={formatCurrency(results.totalInterest)} sub={`Extra money paid for the Loan`} color="#E24B4A" />
        </section>

        {/* --- COMPARISON NAV --- */}
        <div className="flex gap-1 bg-surface p-1 rounded-sm border border-border-color">
           <button 
            onClick={() => setActiveTab('charts')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'charts' ? 'bg-white text-alt border border-border-color shadow-sm' : 'text-tertiary-text hover:text-secondary-text'}`}
           >
             <PieChartIcon className="w-4 h-4" /> Growth Charts
           </button>
           <button 
            onClick={() => setActiveTab('tables')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'tables' ? 'bg-white text-alt border border-border-color shadow-sm' : 'text-tertiary-text hover:text-secondary-text'}`}
           >
             <FileText className="w-4 h-4" /> Yearly Details
           </button>
        </div>

        {/* --- CONTENT AREA --- */}
        <AnimatePresence mode="wait">
          {activeTab === 'charts' ? (
            <motion.div 
              key="charts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
               {/* Chart 1: Wealth Accumulation */}
               <ChartContainer title="Wealth Growth Over Time" sub="Compare House Savings vs Alternate Investment">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={results.yearlyData}>
                      <defs>
                        <linearGradient id="grRE" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#639922" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#639922" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="grAlt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#378ADD" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#378ADD" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" strokeOpacity={0.5} />
                      <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} label={{ value: 'Years', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#64748B' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v) => getLakCrLabel(v)} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: '4px' }}
                        itemStyle={{ fontSize: '11px', textTransform: 'uppercase' }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', textTransform: 'uppercase', paddingBottom: '20px' }} />
                      <Area type="monotone" dataKey="netEquity" name="My Value in Home" stroke="#639922" strokeWidth={2.5} fill="url(#grRE)" />
                      <Area type="monotone" dataKey="altValue" name="Investment Value" stroke="#378ADD" strokeWidth={3} fill="url(#grAlt)" />
                      <Area type="monotone" dataKey="cumInterest" name="Total Interest Paid" stroke="#E24B4A" fill="none" strokeWidth={2} strokeDasharray="5 5" />
                      
                      {results.crossoverYear && (
                        <ReferenceLine 
                          x={results.crossoverYear} 
                          stroke="#EF9F27" 
                          strokeWidth={3} 
                        >
                          <Label 
                            value="SIP STOPPED" 
                            position="top" 
                            fill="#EF9F27" 
                            fontSize={10} 
                            fontWeight="900" 
                          />
                        </ReferenceLine>
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                  
                  {results.crossoverYear ? (
                    <div className="mt-4 p-3 bg-highlight-dark/30 border-l-2 border-highlight rounded-r-md">
                       <p className="text-[10px] text-highlight font-black uppercase tracking-widest mb-1 flex items-center gap-2">
                          <AlertTriangle className="w-3 h-3" /> Rent Crossover: Year {results.crossoverYear}
                       </p>
                       <p className="text-[10px] text-secondary-text leading-relaxed uppercase">
                          Phase 1: Your Rent was lower than Home costs. You were doing a <span className="text-white">Monthly SIP</span>.
                          <br />
                          Phase 2: Rent is now higher. You are now <span className="text-re-light font-bold">Withdrawing</span> from your corpus every month.
                       </p>
                    </div>
                  ) : (
                    <div className="mt-4 p-3 bg-surface border border-border-color rounded-sm">
                       <p className="text-[10px] text-re-light font-black uppercase tracking-widest mb-1">Constant Saving Mode</p>
                       <p className="text-[10px] text-secondary-text leading-relaxed uppercase">
                          Your Rent remains lower than Home ownership costs throughout the 20-year period. You are saving every single month.
                       </p>
                    </div>
                  )}
               </ChartContainer>

               {/* Chart 2: Cash Flow Comparison */}
               <ChartContainer title="Monthly Outflow Comparison" sub="House (EMI+Maint) vs Rent Escalation">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={results.yearlyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" strokeOpacity={0.5} />
                      <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v) => formatCurrency(v).replace('₹', '')} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', textTransform: 'uppercase' }} />
                      <Area type="step" dataKey="monthlyOwnerCost" name="Own: EMI + Maint" stroke="#E24B4A" strokeWidth={2} fill="none" />
                      <Area type="monotone" dataKey="monthlyRent" name="Rent Strategy Cost" stroke="#378ADD" strokeWidth={2} fill="rgba(55, 138, 221, 0.1)" />
                      {results.crossoverYear && (
                        <ReferenceLine 
                          x={results.crossoverYear} 
                          stroke="#EF9F27" 
                          strokeWidth={2} 
                          label={{ value: 'CROSSOVER', fill: '#EF9F27', fontSize: 10, fontWeight: 'bold', position: 'insideBottomRight' }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
               </ChartContainer>
            </motion.div>
          ) : (
            <motion.div 
              key="tables"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* Summary Table */}
              <TableSection 
                title="Simple Summary Comparison" 
                expanded={expandedTable === 'summary'} 
                toggle={() => setExpandedTable(expandedTable === 'summary' ? null : 'summary')}
                colorClass="bg-highlight-dark/20 border-highlight text-highlight-light"
              >
                <ComparisonSummaryTable results={results} downPayment={downPayment} duration={loanDuration} />
              </TableSection>

              {/* RE Schedule */}
              <TableSection 
                title="House Value & Loan Breakdown" 
                expanded={expandedTable === 're'} 
                toggle={() => setExpandedTable(expandedTable === 're' ? null : 're')}
                colorClass="bg-re-dark/20 border-re text-re-light"
              >
                <AmortizationTable results={results} />
              </TableSection>

              {/* Alt Schedule */}
              <TableSection 
                title="Investment Growth Breakdown" 
                expanded={expandedTable === 'alt'} 
                toggle={() => setExpandedTable(expandedTable === 'alt' ? null : 'alt')}
                colorClass="bg-alt-dark/20 border-alt text-alt-light"
              >
                <InvestmentGrowthTable results={results} investmentType={invType} />
              </TableSection>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- FINAL VERDICT --- */}
        <section className="bg-surface border border-re/30 p-8 rounded-sm shadow-xl relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-re/5 rounded-full blur-3xl -mr-16 -mt-16" />
           <div className="flex items-center gap-3 mb-8 border-b border-border-color/50 pb-6">
             <Activity className="text-re w-6 h-6" />
             <h2 className="text-sm font-black uppercase tracking-[0.2em] text-primary-text">Final Investment Verdict</h2>
           </div>
           
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 text-primary-text">
              <div className="space-y-6">
                 {/* Tax Explanation Section */}
                 <div className="bg-[#0F172A] border border-alt/30 p-5 rounded-sm">
                    <h4 className="text-xs font-bold text-alt-light uppercase tracking-widest mb-3 flex items-center gap-2">
                       <Info className="w-3.5 h-3.5" /> Simple Tax Explanation
                    </h4>
                    <p className="text-sm text-secondary-text leading-relaxed">
                       Tax is calculated <span className="text-white font-bold italic">only if you choose to</span>. If you select 0%, no tax is deducted. If you select a percentage, it applies to the total growth of your investment.
                       <br/><br/>
                       <span className="text-[10px] uppercase font-bold text-highlight">Note:</span> Common India LTCG (Long Term Capital Gains) is currently 12.5%.
                    </p>
                 </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-secondary-text mb-4">Comparison of Performance</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-5 bg-re-dark/30 border border-re/20 rounded-sm">
                      <p className="text-[10px] uppercase font-bold text-re-light mb-2">Scenario A XIRR</p>
                      <p className="text-3xl font-black text-re-light">{results.reXIRR.toFixed(2)}%</p>
                    </div>
                    <div className="p-5 bg-alt-dark/30 border border-alt/20 rounded-sm">
                      <p className="text-[10px] uppercase font-bold text-alt-light mb-2">Scenario B XIRR</p>
                      <p className="text-3xl font-black text-alt-light">{results.altXIRR.toFixed(2)}%</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-highlight-dark/20 border border-highlight/30 rounded-sm">
                  <p className="text-xs font-bold uppercase tracking-widest text-highlight mb-3">Which is the better investment?</p>
                  <p className="text-2xl font-black leading-tight text-white mb-2">
                    {results.finalWealthDiff > 0 
                      ? "Scenario A (Home Purchase) is Superior"
                      : "Scenario B (Alternate Investment) is Superior"
                    }
                  </p>
                  <p className="text-sm text-secondary-text font-medium leading-relaxed uppercase">
                    {results.finalWealthDiff > 0 
                      ? `Based on ${appreciationRate}% growth, the property nets you ${formatCurrency(results.finalWealthDiff)} more than the alternate strategy.`
                      : `Investing in alternates at ${altROI}% generates ${formatCurrency(Math.abs(results.finalWealthDiff))} more profit than real estate.`
                    }
                  </p>
                </div>
              </div>

              <div className="space-y-6 flex flex-col justify-center">
                <div className="border-l-4 border-re pl-6">
                   <h4 className="text-xs font-bold uppercase tracking-widest text-re-light mb-2">Financial Summary</h4>
                   <p className="text-sm text-secondary-text leading-relaxed uppercase">
                     Real Estate provides significant leverage but high interest costs. Alternate investments offer liquidity and compounding without debt burdens. Always maintain emergency liquid funds before committing to long-term property.
                   </p>
                </div>
                
                <div className="flex flex-col gap-4 pt-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-secondary-text uppercase tracking-widest border-b border-border-color/30 pb-1 mb-3">Wealth Multipliers (Total Growth / Principle Basis)</span>
                    <div className="grid grid-cols-2 gap-8">
                       <div className="border-l-2 border-re pl-3">
                          <p className="text-[9px] uppercase font-bold text-re-light opacity-70">Scenario A</p>
                          <p className="text-xl font-black text-white">{results.reMultiplier.toFixed(2)}x</p>
                       </div>
                       <div className="border-l-2 border-alt pl-3">
                          <p className="text-[9px] uppercase font-bold text-alt-light opacity-70">Scenario B</p>
                          <p className="text-xl font-black text-white">{results.altMultiplier.toFixed(2)}x</p>
                          {results.taxDeducted > 0 && (
                            <p className="text-[9px] font-bold text-alt-light/60 mt-0.5 uppercase tracking-tighter">
                              Post-Tax (Ded. {getLakCrLabel(results.taxDeducted)})
                            </p>
                          )}
                       </div>
                    </div>
                  </div>
                </div>
              </div>
           </div>
        </section>

        <footer className="pt-10 border-t border-border-color flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-tertiary-text uppercase font-mono tracking-widest">
           <div>Analysis powered by Arbitrage High-Yield Prediction models</div>
           <div>&copy; 2026 Asset Intelligence Systems</div>
        </footer>

        {/* --- HIDDEN PDF REPORT TEMPLATE --- */}
        <div id="pdf-report-container" style={{ display: 'none' }} className="p-10 bg-[#0F172A] text-white">
            <h1 className="text-4xl font-black uppercase mb-10 border-b border-border-color pb-5">Investment Analysis Report</h1>
            
            <div className="grid grid-cols-2 gap-10 mb-10">
                <div className="p-5 border border-re/30 bg-re-dark/10 rounded-sm">
                    <h3 className="text-xs font-bold uppercase text-re mb-3">Scenario A: Home Purchase</h3>
                    <div className="space-y-1 text-sm">
                        <p>Principal Basis: {formatCurrency(propertyPrice)}</p>
                        <p>Loan: {formatCurrency(loanAmount)} @ {interestRate}%</p>
                        <p>Growth: {appreciationRate}% Annually</p>
                    </div>
                </div>
                <div className="p-5 border border-alt/30 bg-alt-dark/10 rounded-sm">
                    <h3 className="text-xs font-bold uppercase text-alt mb-3">Scenario B: Alternate Investment</h3>
                    <div className="space-y-1 text-sm">
                        <p>Initial Capital: {formatCurrency(propertyPrice)}</p>
                        <p>ROI: {altROI}% Compounded</p>
                        <p>Tax Slab: {selectedTaxRate}%</p>
                    </div>
                </div>
            </div>

            <div className="mb-10 p-8 border border-highlight bg-surface rounded-sm">
              <h2 className="text-xl font-black uppercase mb-4">Investment Verdict</h2>
              <p className="text-2xl font-black text-highlight-light underline decoration-highlight mb-6">
                 {results.finalWealthDiff > 0 ? "SCENARIO A IS SUPERIOR" : "SCENARIO B IS SUPERIOR"}
              </p>
              <div className="grid grid-cols-2 gap-8">
                <div>
                   <p className="text-[10px] uppercase font-bold opacity-70 mb-1">Scenario A Multiplier</p>
                   <p className="text-3xl font-black text-re-light">{results.reMultiplier.toFixed(2)}x</p>
                </div>
                <div>
                   <p className="text-[10px] uppercase font-bold opacity-70 mb-1">Scenario B Multiplier</p>
                   <p className="text-3xl font-black text-alt-light">{results.altMultiplier.toFixed(2)}x</p>
                   {results.taxDeducted > 0 && (
                     <p className="text-[9px] uppercase font-bold text-alt-light/60 mt-1">
                       Tax Deducted: {formatCurrency(results.taxDeducted)}
                     </p>
                   )}
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-border-color/30">
                 <p className="text-[10px] uppercase opacity-70 mb-1">Final Wealth Gap</p>
                 <p className="text-2xl font-bold">{formatCurrency(Math.abs(results.finalWealthDiff))}</p>
              </div>
            </div>

            <h3 className="text-xs font-bold uppercase mb-5">Wealth Growth Comparison</h3>
            <div className="h-[300px] mb-20">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={results.yearlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="year" tick={{ fill: '#94A3B8' }} />
                    <YAxis tick={{ fill: '#94A3B8' }} tickFormatter={(v) => getLakCrLabel(v)} />
                    <Area type="monotone" dataKey="netEquity" name="Home Value" stroke="#639922" fill="#639922" fillOpacity={0.2} />
                    <Area type="monotone" dataKey="altValue" name="Alt Investment" stroke="#378ADD" fill="#378ADD" fillOpacity={0.2} />
                  </AreaChart>
               </ResponsiveContainer>
            </div>

            <h3 className="text-xs font-bold uppercase mb-5">Yearly Detailed Breakdown</h3>
            <div className="space-y-10">
               <AmortizationTable results={results} />
               <InvestmentGrowthTable results={results} investmentType={invType} />
            </div>
        </div>
      </div>
    </div>
  );
}

// --- SUBCOMPONENTS ---

function MetricCard({ label, value, sub, color, highlight }: { label: string; value: string; sub: string; color: string; highlight?: boolean }) {
  return (
    <div className={`p-6 border border-border-color bg-surface shadow-sm relative overflow-hidden ${highlight ? 'ring-2 ring-highlight/50' : ''}`}>
       <div className="absolute w-1 h-full left-0 top-0" style={{ backgroundColor: color }} />
       <p className="text-[10px] uppercase font-bold text-tertiary-text tracking-widest mb-1">{label}</p>
       <p className="text-3xl font-black tracking-tighter" style={{ color: value.includes('-') && !highlight ? '#E24B4A' : highlight ? '#F8FAFC' : color }}>{value}</p>
       <p className="text-[10px] uppercase font-bold text-secondary-text mt-2 tracking-wide">{sub}</p>
    </div>
  );
}

function SliderInput({ label, value, onChange, min, max, step, suffix = "", isCurrency = false, subLabel }: { 
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string; isCurrency?: boolean; subLabel?: string
}) {
  const [inputValue, setInputValue] = useState(value.toString());
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleBlur = () => {
    setIsFocused(false);
    let parsed = parseFloat(inputValue.replace(/,/g, ''));
    if (isNaN(parsed)) parsed = min;
    parsed = Math.min(max, Math.max(min, parsed));
    onChange(parsed);
    setInputValue(parsed.toString());
  };

  const getFormattedValue = (raw: string) => {
    if (!isCurrency) return raw;
    const parts = raw.split('.');
    const cleanInt = parts[0].replace(/,/g, '');
    if (cleanInt === "" && parts.length > 1) return `0.${parts[1]}`;
    if (cleanInt === "") return "";
    
    const num = parseInt(cleanInt);
    if (isNaN(num)) return raw;

    const formattedInt = new Intl.NumberFormat('en-IN').format(num);
    return parts.length > 1 ? `${formattedInt}.${parts[1]}` : formattedInt;
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalValue = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;
    
    // strip commas for internal storage
    const clean = originalValue.replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    const finalClean = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : clean;
    
    setInputValue(finalClean);
    
    // Update parent
    const parsed = parseFloat(finalClean);
    if (!isNaN(parsed) && !finalClean.endsWith('.')) {
      onChange(Math.min(max, Math.max(min, parsed)));
    }

    // Handle cursor position logic for commas
    if (isCurrency && inputRef.current) {
      setTimeout(() => {
        if (!inputRef.current) return;
        const newVal = getFormattedValue(finalClean);
        const diff = newVal.length - originalValue.length;
        const newPos = Math.max(0, cursorPosition + diff);
        inputRef.current.setSelectionRange(newPos, newPos);
      }, 0);
    }
  };

  // Synchronize internal state when value prop changes from slider/external
  useMemo(() => {
    if (!isFocused) {
      setInputValue(value.toString());
    }
  }, [value, isFocused]);

  const displayValue = isFocused 
    ? getFormattedValue(inputValue)
    : isCurrency 
      ? formatIndianNumber(value, 0)
      : value.toString();

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase font-bold text-secondary-text tracking-widest">{label}</label>
        {subLabel && (
          <span className="text-[9px] leading-tight text-highlight font-black uppercase tracking-widest border-l-2 border-highlight/50 pl-2">
            {subLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 bg-input-bg border border-border-color rounded-md px-3 py-2 shadow-inner group-focus-within:border-alt transition-colors">
        {isCurrency && <span className="text-sm font-bold text-alt-light">₹</span>}
        <input 
          ref={inputRef}
          type="text"
          value={displayValue}
          onFocus={() => setIsFocused(true)}
          onChange={handleTextChange}
          onBlur={handleBlur}
          className="w-full text-base font-black text-primary-text bg-transparent outline-none"
        />
        <span className="text-xs font-bold text-tertiary-text">{suffix}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-border-color rounded-lg appearance-none cursor-pointer accent-alt"
      />
      {isCurrency && value >= 1000 && (
         <p className="text-xs text-right text-tertiary-text font-bold uppercase italic leading-none">
           {getLakCrLabel(value)}
         </p>
      )}
    </div>
  );
}

function ChartContainer({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="bg-surface border border-border-color p-8 rounded-md shadow-lg">
      <div className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-secondary-text mb-1">{title}</h3>
        <p className="text-xs uppercase font-bold text-tertiary-text tracking-wide">{sub}</p>
      </div>
      <div className="h-64 sm:h-80 w-full">
        {children}
      </div>
    </div>
  );
}

function TableSection({ title, expanded, toggle, children, colorClass }: { title: string; expanded: boolean; toggle: () => void; children: ReactNode; colorClass: string }) {
  return (
    <div className={`border rounded-sm overflow-hidden ${colorClass}`}>
      <button onClick={toggle} className="w-full px-6 py-4 flex justify-between items-center transition-all">
        <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-x-auto bg-[#0F172A]">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InsightItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="space-y-3">
       <h4 className="text-[10px] uppercase font-bold text-primary-text tracking-widest underline decoration-highlight/50 underline-offset-4">{title}</h4>
       <p className="text-xs text-secondary-text font-medium leading-relaxed uppercase">{desc}</p>
    </div>
  );
}

// --- TABLES ---

function ComparisonSummaryTable({ results, downPayment, duration }: any) {
  const reNetGain = results.reFinalNetWealth - downPayment;
  const altNetGain = results.finalAltWealth - downPayment;

  return (
    <table className="w-full text-left font-sans">
      <thead className="bg-[#0F172A] text-xs uppercase text-secondary-text border-b border-border-color">
        <tr>
          <th className="px-6 py-6 tracking-widest">Outcome Metric</th>
          <th className="px-6 py-6 italic">House Choice</th>
          <th className="px-6 py-6 italic">Alternate Choice</th>
          <th className="px-6 py-6 text-right">Spread</th>
        </tr>
      </thead>
      <tbody className="text-sm divide-y divide-border-color/30 text-primary-text">
        <SummaryRow label="Initial Cash Basis" re={formatCurrency(downPayment)} alt={formatCurrency(downPayment)} diff="Equal" />
        <SummaryRow label="Portfolio Value end of YR" re={formatCurrency(results.yearlyData[results.yearlyData.length-1].propValue)} alt={formatCurrency(results.yearlyData[results.yearlyData.length-1].altValue)} diff={formatCurrency(Math.abs(results.yearlyData[results.yearlyData.length-1].propValue - results.yearlyData[results.yearlyData.length-1].altValue))} />
        <SummaryRow label="True Net Wealth (Post-Tax)" re={formatCurrency(results.reFinalNetWealth)} alt={formatCurrency(results.finalAltWealth)} diff={formatCurrency(Math.abs(results.finalWealthDiff))} isFinal />
        <SummaryRow label="Growth Multiplier" re={`${results.reMultiplier.toFixed(2)}x`} alt={`${results.altMultiplier.toFixed(2)}x`} diff="" />
        <tr className="bg-highlight-dark/30">
           <td className="px-6 py-6 font-black uppercase text-highlight-light">Break-even ROI needed</td>
           <td className="px-6 py-6">-</td>
           <td className="px-6 py-6 font-black text-2xl text-highlight leading-none">{results.reXIRR.toFixed(2)}%</td>
           <td className="px-6 py-6 text-right opacity-80 text-xs font-bold uppercase italic">The Threshold</td>
        </tr>
      </tbody>
    </table>
  );
}

function SummaryRow({ label, re, alt, diff, isFinal }: any) {
  return (
    <tr className={isFinal ? 'bg-surface' : ''}>
      <td className="px-6 py-4 text-secondary-text uppercase tracking-tighter">{label}</td>
      <td className={`px-6 py-4 ${isFinal ? 'font-bold text-re' : ''}`}>{re}</td>
      <td className={`px-6 py-4 ${isFinal ? 'font-bold text-alt' : ''}`}>{alt}</td>
      <td className="px-6 py-4 text-right text-tertiary-text font-mono italic">{diff}</td>
    </tr>
  );
}

function AmortizationTable({ results }: any) {
  return (
    <table className="w-full text-left font-mono">
      <thead className="bg-success-dark/40 text-xs uppercase text-success-light border-b border-border-color">
        <tr>
          <th className="px-6 py-4">End Year</th>
          <th className="px-6 py-4">Loan Balance</th>
          <th className="px-6 py-4">Principal Paid</th>
          <th className="px-6 py-4">Interest Cost</th>
          <th className="px-6 py-4 text-re-light font-black">Net Equity</th>
        </tr>
      </thead>
      <tbody className="text-xs text-primary-text divide-y divide-border-color/20">
        {results.yearlyData.map((row: any) => (
          <tr key={row.year} className="hover:bg-hover/20 transition-colors">
            <td className="px-6 py-4 font-black text-tertiary-text">YEAR {row.year}</td>
            <td className="px-6 py-4">{formatCurrency(row.loanBalance)}</td>
            <td className="px-6 py-4 text-secondary-text italic">{formatCurrency(row.year === 0 ? 0 : (results.yearlyData[0].loanBalance - row.loanBalance))}</td>
            <td className="px-6 py-4 text-interest-light/80">{formatCurrency(row.cumInterest)}</td>
            <td className="px-6 py-4 font-black text-re-light text-base">{formatCurrency(row.netEquity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InvestmentGrowthTable({ results, investmentType }: any) {
  return (
    <table className="w-full text-left font-mono">
      <thead className="bg-alt-dark/40 text-[10px] uppercase text-alt-light">
        <tr>
          <th className="px-6 py-4">Year</th>
          <th className="px-6 py-4">Strategy</th>
          <th className="px-6 py-4">ROI Target</th>
          <th className="px-6 py-4 text-alt-light font-black">Net Asset Value</th>
          <th className="px-6 py-4 text-right">Cumulative Gain</th>
        </tr>
      </thead>
      <tbody className="text-[10px] md:text-xs text-primary-text divide-y divide-border-color/20">
        {results.yearlyData.map((row: any) => (
          <tr key={row.year} className="hover:bg-hover/20 transition-colors">
            <td className="px-6 py-3 font-bold text-tertiary-text">YR{row.year}</td>
            <td className="px-6 py-3 uppercase text-[9px] text-secondary-text font-bold">{investmentType}</td>
            <td className="px-6 py-3 text-tertiary-text font-mono">STABLE</td>
            <td className="px-6 py-3 font-black text-alt-light text-base">{formatCurrency(row.altValue)}</td>
            <td className="px-6 py-3 text-right text-re-light font-bold">{formatCurrency(row.altValue - results.yearlyData[0].altValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
