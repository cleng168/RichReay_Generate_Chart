/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// We are using Chart.js, xlsx, and jsPDF via CDN, so declare them for TypeScript
declare var Chart: any;
declare var XLSX: any;

// Augment the Window interface to inform TypeScript about the jspdf structure
declare global {
  interface Window {
    jspdf?: {
      jsPDF: new (options?: any) => any; // jsPDF constructor
      [key: string]: any; // Allow other properties on jspdf namespace
    };
  }
}

interface ExcelRow {
    [key: string]: any;
    pvStatus?: 'Paid' | 'Unpaid'; // Added to store determined PV status
}

const fileUpload = document.getElementById('fileUpload') as HTMLInputElement;
const messageArea = document.getElementById('messageArea') as HTMLDivElement;
const chartCanvas = document.getElementById('dataChart') as HTMLCanvasElement;
const chartLoader = document.getElementById('chartLoader') as HTMLDivElement;
const topItemsList = document.getElementById('topItemsList') as HTMLUListElement;
const topItemsHeading = document.getElementById('topItemsHeading') as HTMLHeadingElement;
const chartTypeRadios = document.querySelectorAll<HTMLInputElement>('input[name="chartType"]');
const topNSelect = document.getElementById('topNSelect') as HTMLSelectElement;
const valueColumnSelect = document.getElementById('valueColumnSelect') as HTMLSelectElement;
const labelColumnSelect = document.getElementById('labelColumnSelect') as HTMLSelectElement;

const exportChartPdfButton = document.getElementById('exportChartPdfButton') as HTMLButtonElement;
const exportExcelButton = document.getElementById('exportExcelButton') as HTMLButtonElement;

// Panel visibility elements
const appNavbar = document.getElementById('app-navbar') as HTMLElement;
const sidebarToggleButton = document.getElementById('sidebar-toggle-button') as HTMLButtonElement;
const mainContainerWrapper = document.getElementById('main-container-wrapper') as HTMLElement;
const appSidebar = document.getElementById('app-sidebar') as HTMLElement;
const appMainContent = document.getElementById('app-main-content') as HTMLElement;


let currentChart: any | null = null;
let SPREADSHEET_DATA: ExcelRow[] = [];
let CURRENT_SORTED_DATA: ExcelRow[] = []; 

// Default selections
let selectedTopN: number = 10;
let selectedValueColumn: string = 'Total'; 
let selectedLabelColumn: string = 'Supply Name'; 

const PV_CODE_COLUMN_NAME = 'Paid Method'; 
const REQUESTER_COLUMN_NAME = 'Requester';
const PV_CODE_FOR_DISPLAY_COLUMN_NAME = 'PV Code'; 
const SUPPLY_NAME_COLUMN_KEY = 'Supply Name'; 
const CREATE_DATE_COLUMN_NAME = 'Created Date'; // Updated to match user's Excel
const PAID_DATE_COLUMN_NAME = 'Paid Date';
const PAID_BY_COLUMN_NAME = 'Paid By';
const PURPOSE_COLUMN_NAME = 'Purpose'; 
const TOTAL_AMOUNT_COLUMN_FOR_SUMMATION = 'Total'; // Column to sum for "Total Paid"

const TOTAL_PAID_DISPLAY_NAME = 'Total Paid';


const BASE_MESSAGE_CLASSES = 'p-4 rounded-lg font-medium text-center text-sm shadow-lg border';
const MESSAGE_TYPE_CLASSES = {
    error: 'bg-red-50 text-red-700 border-red-300',
    success: 'bg-blue-50 text-blue-700 border-blue-300', 
    info: 'bg-slate-50 text-slate-700 border-slate-300', 
};

const MODERN_CHART_COLORS = [
    'rgba(59, 130, 246, 0.85)',  // blue-500
    'rgba(16, 185, 129, 0.85)',  // emerald-500 -> green-500
    'rgba(249, 115, 22, 0.85)',  // orange-500
    'rgba(139, 92, 246, 0.85)',  // violet-500
    'rgba(236, 72, 153, 0.85)',  // pink-500
    'rgba(20, 184, 166, 0.85)',  // teal-500
    'rgba(245, 158, 11, 0.85)',  // amber-500
    'rgba(99, 102, 241, 0.85)',  // indigo-500
    'rgba(239, 68, 68, 0.85)',   // red-500
    'rgba(14, 165, 233, 0.85)',  // sky-500
    'rgba(217, 70, 239, 0.85)',  // fuchsia-500
    'rgba(77, 124, 15, 0.85)'    // lime-700
];

const MODERN_CHART_HOVER_COLORS = MODERN_CHART_COLORS.map(color => color.replace('0.85', '1'));
const MODERN_CHART_BORDER_COLOR = 'rgba(255, 255, 255, 0.9)';


const showChartLoader = () => {
    if (chartLoader) chartLoader.classList.remove('hidden');
    if (chartCanvas) chartCanvas.style.display = 'none'; 
};

const hideChartLoader = () => {
    if (chartLoader) chartLoader.classList.add('hidden');
    if (chartCanvas) chartCanvas.style.display = 'block'; 
};

const showMessage = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    messageArea.textContent = message;
    messageArea.className = `${BASE_MESSAGE_CLASSES} ${MESSAGE_TYPE_CLASSES[type]}`;
    messageArea.style.display = 'block';
    messageArea.setAttribute('role', type === 'error' ? 'alert' : 'status');
    if (type === 'error') {
        messageArea.setAttribute('aria-live', 'assertive');
    } else {
        messageArea.setAttribute('aria-live', 'polite');
    }
};

const clearMessage = () => {
    messageArea.textContent = '';
    messageArea.style.display = 'none';
    messageArea.removeAttribute('role');
    messageArea.removeAttribute('aria-live');
    messageArea.className = ''; 
};

const updateExportButtonsState = () => {
    const chartDataAvailable = currentChart && currentChart.data && currentChart.data.labels && currentChart.data.labels.length > 0;
    if (exportChartPdfButton) {
        exportChartPdfButton.disabled = !chartDataAvailable;
        exportChartPdfButton.setAttribute('aria-disabled', String(!chartDataAvailable));
    }
    if (exportExcelButton) {
        exportExcelButton.disabled = !chartDataAvailable;
        exportExcelButton.setAttribute('aria-disabled', String(!chartDataAvailable));
    }
};

const getValueColumnDisplayString = (valueCol: string): string => {
    if (valueCol === 'Total') {
        return TOTAL_PAID_DISPLAY_NAME;
    } else if (valueCol === 'Processing Speed') {
        return `${valueCol} Days`;
    }
    return valueCol;
};

const formatDateForDisplay = (dateValue: any): string => {
    if (dateValue instanceof Date) {
        if (isNaN(dateValue.getTime())) { // Check for invalid date
            return 'N/A';
        }
        return dateValue.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    const stringValue = String(dateValue ?? '').trim(); // Handle null/undefined, then trim
    return stringValue === '' ? 'N/A' : stringValue;
};


const updateDynamicStatsValues = (data: ExcelRow[]) => {
    const pvCodeValueEl = document.getElementById('statCardPvCodeCountValue') as HTMLSpanElement;
    const supplyNameValueEl = document.getElementById('statCardSupplyNameCountValue') as HTMLSpanElement;
    const totalPaidValueEl = document.getElementById('statCardTotalPaidValue') as HTMLSpanElement;

    if (!pvCodeValueEl || !supplyNameValueEl || !totalPaidValueEl) {
        // console.warn('One or more stats card value elements not found.');
    }

    let pvCodeCount = 0;
    let uniqueSupplyNameCount = 0;
    let totalPaidAmount = 0;

    if (data.length > 0) {
        // Calculate total PV Code count
        pvCodeCount = data.filter(row =>
            row[PV_CODE_FOR_DISPLAY_COLUMN_NAME] !== undefined &&
            String(row[PV_CODE_FOR_DISPLAY_COLUMN_NAME]).trim() !== ''
        ).length;

        // Calculate unique Supply Name count and Total Paid amount
        const uniqueSupplyNames = new Set<string>();
        data.forEach(row => {
            const supplyName = String(row[SUPPLY_NAME_COLUMN_KEY] || '').trim();
            if (supplyName) {
                uniqueSupplyNames.add(supplyName);
            }

            // Calculate Total Paid
            const pvCodeRawValue = row[PV_CODE_COLUMN_NAME]; // 'Paid Method'
            let isPaid = false;
            if (pvCodeRawValue !== null && pvCodeRawValue !== undefined) {
                const stringValue = String(pvCodeRawValue).trim();
                if (stringValue !== "") {
                    isPaid = true;
                }
            }

            if (isPaid) {
                const amountValue = row[TOTAL_AMOUNT_COLUMN_FOR_SUMMATION]; // 'Total'
                if (amountValue !== undefined && amountValue !== null) {
                    const amount = parseFloat(String(amountValue));
                    if (!isNaN(amount)) {
                        totalPaidAmount += amount;
                    }
                }
            }
        });
        uniqueSupplyNameCount = uniqueSupplyNames.size;
    }

    if (pvCodeValueEl) pvCodeValueEl.textContent = pvCodeCount.toString();
    if (supplyNameValueEl) supplyNameValueEl.textContent = uniqueSupplyNameCount.toString();
    if (totalPaidValueEl) {
        totalPaidValueEl.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalPaidAmount);
    }
};


const renderChart = (dataToProcess: ExcelRow[]) => {
    if (!chartCanvas) return;
    showChartLoader();
    CURRENT_SORTED_DATA = []; 
    
    if (!messageArea.className.includes(MESSAGE_TYPE_CLASSES.error.split(' ')[0])) {
        clearMessage();
    }

    selectedTopN = parseInt(topNSelect.value);
    selectedValueColumn = valueColumnSelect.value; 
    selectedLabelColumn = labelColumnSelect.value;

    const valueColumnDisplay = getValueColumnDisplayString(selectedValueColumn);
    const topNLabel = selectedTopN === -1 ? 'All' : `Top ${selectedTopN}`;

    // Update stats cards with current data
    updateDynamicStatsValues(dataToProcess);


    if (topItemsHeading) {
        topItemsHeading.textContent = `${topNLabel} ${selectedLabelColumn} by ${valueColumnDisplay}`;
    }

    if (dataToProcess.length === 0) {
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
        if (fileUpload.files && fileUpload.files.length > 0) {
             showMessage('No data to display. Check Excel content or column selections.', 'info');
        }
        topItemsList.innerHTML = `<li class="text-slate-500 italic p-4 text-center bg-white rounded-md shadow-sm">No data available. Please upload a file.</li>`;
        hideChartLoader();
        updateExportButtonsState();
        return;
    }
    
    const dataWithPvStatus = dataToProcess.map(row => {
        const pvCodeRawValue = row[PV_CODE_COLUMN_NAME];
        let isPaid = false;
        if (pvCodeRawValue !== null && pvCodeRawValue !== undefined) {
            const stringValue = String(pvCodeRawValue).trim();
            if (stringValue !== "") {
                isPaid = true;
            }
        }
        return { ...row, pvStatus: isPaid ? 'Paid' : 'Unpaid' } as ExcelRow;
    });

    let columnError = '';
    if (dataWithPvStatus.length > 0 && !dataWithPvStatus[0].hasOwnProperty(selectedLabelColumn)) {
        columnError += `Label column '${selectedLabelColumn}' not found. `;
    }
    if (dataWithPvStatus.length > 0 && !dataWithPvStatus[0].hasOwnProperty(selectedValueColumn)) {
        columnError += `Analysis column '${selectedValueColumn}' (displaying as '${valueColumnDisplay}') not found. `;
    }


    if (columnError) {
        showMessage(columnError + 'Verify column names or select different ones.', 'error');
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
        topItemsList.innerHTML = `<li class="text-red-600 italic p-4 text-center bg-red-50 rounded-md shadow-sm border border-red-200">Error: ${columnError.trim()}</li>`;
        hideChartLoader();
        updateExportButtonsState();
        return;
    }

    let sortedData = [...dataWithPvStatus]
        .filter(row => row[selectedValueColumn] !== undefined && row[selectedValueColumn] !== null && !isNaN(parseFloat(row[selectedValueColumn])))
        .sort((a, b) => parseFloat(b[selectedValueColumn]) - parseFloat(a[selectedValueColumn]));
    
    if (selectedTopN !== -1 && selectedTopN > 0) {
        sortedData = sortedData.slice(0, selectedTopN);
    }
    
    CURRENT_SORTED_DATA = sortedData; 

    if (sortedData.length === 0) {
        if (!messageArea.className.includes(MESSAGE_TYPE_CLASSES.error.split(' ')[0])) {
           showMessage(`No valid numerical data in '${valueColumnDisplay}' for ${topNLabel.toLowerCase()} items. Check content or options.`, 'info');
        }
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
        topItemsList.innerHTML = '<li class="text-slate-500 italic p-4 text-center bg-white rounded-md shadow-sm">No valid data for current selections.</li>';
        hideChartLoader();
        updateExportButtonsState();
        return;
    }
    
    const labels = sortedData.map(row => String(row[selectedLabelColumn] || 'Unnamed Item'));
    const values = sortedData.map(row => parseFloat(row[selectedValueColumn]));

    topItemsList.innerHTML = ''; 
    if (sortedData.length > 0) {
        sortedData.forEach((item, index) => {
            const listItem = document.createElement('li');
            listItem.className = "p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex items-start space-x-3 hover:bg-blue-50 transition-colors duration-150 group";
            
            const rankSpan = document.createElement('span');
            rankSpan.className = "flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-700 font-semibold rounded-full text-sm group-hover:bg-blue-500 group-hover:text-white transition-colors mt-0.5";
            rankSpan.textContent = `${index + 1}`;

            const itemDetailsDiv = document.createElement('div');
            itemDetailsDiv.className = "flex-grow min-w-0"; 

            const itemName = document.createElement('span');
            itemName.className = "font-medium text-slate-700 truncate group-hover:text-blue-800 block";
            itemName.textContent = item[selectedLabelColumn] || 'Unnamed Item';
            itemName.title = item[selectedLabelColumn] || 'Unnamed Item';
            
            const statusSpan = document.createElement('span');
            statusSpan.textContent = item.pvStatus || 'N/A';
            statusSpan.className = `text-xs font-semibold px-2 py-0.5 rounded-full mr-2 inline-block mb-1 ${
                item.pvStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`;

            itemDetailsDiv.appendChild(itemName);
            itemDetailsDiv.appendChild(statusSpan);

            const createDateVal = item[CREATE_DATE_COLUMN_NAME];
            const paidDateVal = item[PAID_DATE_COLUMN_NAME];
            const purposeVal = item[PURPOSE_COLUMN_NAME];

            const createDateDisplay = document.createElement('p');
            createDateDisplay.className = "text-xs text-slate-500 group-hover:text-slate-600 mt-1";
            createDateDisplay.innerHTML = `<span class="font-medium text-slate-600 group-hover:text-slate-700">Create Date:</span> ${formatDateForDisplay(createDateVal)}`;
            itemDetailsDiv.appendChild(createDateDisplay);
            
            const paidDateDisplay = document.createElement('p');
            paidDateDisplay.className = "text-xs text-slate-500 group-hover:text-slate-600 mt-0.5";
            paidDateDisplay.innerHTML = `<span class="font-medium text-slate-600 group-hover:text-slate-700">Paid Date:</span> ${formatDateForDisplay(paidDateVal)}`;
            itemDetailsDiv.appendChild(paidDateDisplay);

            const purposeDisplay = document.createElement('p');
            purposeDisplay.className = "text-xs text-slate-500 group-hover:text-slate-600 mt-0.5";
            let purposeText = String(purposeVal ?? '').trim();
            purposeText = purposeText === '' ? 'N/A' : purposeText;
            purposeDisplay.innerHTML = `<span class="font-medium text-slate-600 group-hover:text-slate-700">Purpose:</span> ${purposeText}`;
            itemDetailsDiv.appendChild(purposeDisplay);


            const itemValue = document.createElement('span');
            itemValue.className = "text-blue-600 font-bold text-lg group-hover:text-blue-700 ml-auto flex-shrink-0 text-right"; 
            
            let formattedDisplayValue = new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 2 }).format(item[selectedValueColumn]);
            if (selectedValueColumn === 'Total') { 
                formattedDisplayValue = `\$${formattedDisplayValue}`;
            } else if (selectedValueColumn === 'Processing Speed') {
                formattedDisplayValue = `${formattedDisplayValue} Days`;
            }
            itemValue.textContent = formattedDisplayValue;
            
            listItem.appendChild(rankSpan);
            listItem.appendChild(itemDetailsDiv);
            listItem.appendChild(itemValue);
            topItemsList.appendChild(listItem);
        });
    } else {
         topItemsList.innerHTML = '<li class="text-slate-500 italic p-4 text-center bg-white rounded-md shadow-sm">No items to display for the current selection.</li>';
    }

    const selectedChartType = (document.querySelector('input[name="chartType"]:checked') as HTMLInputElement)?.value || 'bar';

    if (currentChart) {
        currentChart.destroy();
    }

    const chartContext = chartCanvas.getContext('2d');
    if (!chartContext) {
        showMessage('Failed to get chart context. Please try reloading.', 'error');
        hideChartLoader();
        updateExportButtonsState();
        return;
    }
    
    Chart.defaults.font.family = "'Kantumruy Pro', sans-serif";
    Chart.defaults.font.size = 13;
    Chart.defaults.color = '#475569'; 
    Chart.defaults.borderColor = '#e2e8f0'; 

    const isPieOrDoughnut = selectedChartType === 'pie' || selectedChartType === 'doughnut';
    
    const chartPrimaryColor = 'rgba(37, 99, 235, 1)'; 
    const chartFillColor = 'rgba(59, 130, 246, 0.6)'; 
    const chartHoverFillColor = 'rgba(37, 99, 235, 0.8)'; 
    const chartHoverBorderColor = 'rgba(29, 78, 216, 1)'; 
    const axisTitleColor = '#1d4ed8'; 

    let xAxisTickConfig: {
        color: string;
        padding: number;
        maxRotation: number;
        minRotation: number;
        autoSkip: boolean;
        font: { size: number };
        align: 'start' | 'center' | 'end';
    } = {
        color: '#64748b', 
        padding: 10,       
        maxRotation: 0,
        minRotation: 0,
        autoSkip: false,
        font: { size: 11 }, 
        align: 'center'
    };

    let dynamicLayoutBottomPadding: number;
    const numLabels = labels.length;

    if (isPieOrDoughnut) {
        dynamicLayoutBottomPadding = 20; 
    } else {
        xAxisTickConfig.maxRotation = 0;
        xAxisTickConfig.minRotation = 0;
        xAxisTickConfig.autoSkip = false;
        xAxisTickConfig.font.size = 11;
        xAxisTickConfig.align = 'center';
        dynamicLayoutBottomPadding = 70; 

        if (numLabels > 20) { 
            xAxisTickConfig.maxRotation = 90;
            xAxisTickConfig.minRotation = 90;
            xAxisTickConfig.autoSkip = true;
            xAxisTickConfig.font.size = 9;
            xAxisTickConfig.align = 'end';
            dynamicLayoutBottomPadding = 180; 
        } else if (numLabels > 12) { 
            xAxisTickConfig.maxRotation = 75;
            xAxisTickConfig.minRotation = 75;
            xAxisTickConfig.autoSkip = true;
            xAxisTickConfig.font.size = 10;
            xAxisTickConfig.align = 'end';
            dynamicLayoutBottomPadding = 160; 
        } else if (numLabels > 7) { 
            xAxisTickConfig.maxRotation = 60; 
            xAxisTickConfig.minRotation = 60;
            xAxisTickConfig.autoSkip = true;
            xAxisTickConfig.font.size = 10; 
            xAxisTickConfig.align = 'end'; 
            dynamicLayoutBottomPadding = 140; 
        } else if (numLabels > 4) { 
            xAxisTickConfig.maxRotation = 45;
            xAxisTickConfig.minRotation = 45;
            xAxisTickConfig.autoSkip = true; 
            xAxisTickConfig.align = 'end';
            dynamicLayoutBottomPadding = 110; 
        }
    }


    try {
        currentChart = new Chart(chartContext, {
            type: selectedChartType,
            data: {
                labels: labels,
                datasets: [{
                    label: valueColumnDisplay,
                    data: values,
                    backgroundColor: isPieOrDoughnut ? generatePieColors(values.length, false, false) : chartFillColor, 
                    borderColor: isPieOrDoughnut ? generatePieColors(values.length, true, false) : chartPrimaryColor, 
                    borderWidth: isPieOrDoughnut ? 3 : 2,
                    hoverBackgroundColor: isPieOrDoughnut ? generatePieColors(values.length, false, true) : chartHoverFillColor, 
                    hoverBorderColor: isPieOrDoughnut ? generatePieColors(values.length, true, true) : chartHoverBorderColor, 
                    borderRadius: selectedChartType === 'bar' ? 5 : 0,
                    tension: selectedChartType === 'line' ? 0.35 : 0,
                    pointBackgroundColor: selectedChartType === 'line' ? chartPrimaryColor : undefined,
                    pointBorderColor: selectedChartType === 'line' ? '#fff' : undefined,
                    pointHoverBackgroundColor: selectedChartType === 'line' ? '#fff' : undefined,
                    pointHoverBorderColor: selectedChartType === 'line' ? chartHoverBorderColor : undefined,
                    pointRadius: selectedChartType === 'line' ? 4 : undefined,
                    pointHoverRadius: selectedChartType === 'line' ? 6 : undefined,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { 
                    duration: 800,
                    easing: 'easeInOutQuart'
                },
                layout: {
                    padding: { bottom: dynamicLayoutBottomPadding, top: 20, left:10, right:20 }
                },
                scales: !isPieOrDoughnut ? {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: valueColumnDisplay, font: { weight: '600', size: 14 }, color: axisTitleColor, padding: {top: 0, bottom: 10} },
                        grid: { color: '#f1f5f9' }, 
                        ticks: { color: '#64748b', padding: 10 } 
                    },
                    x: {
                        title: { display: true, text: selectedLabelColumn, font: { weight: '600', size: 14 }, color: axisTitleColor, padding: {top: 20, bottom: 0} },
                        grid: { display: false },
                        ticks: xAxisTickConfig 
                    }
                } : {},
                plugins: {
                    legend: {
                        position: isPieOrDoughnut ? 'bottom' : 'top',
                        align: isPieOrDoughnut ? 'center' : 'end',
                        labels: {
                           color: '#475569', 
                           padding: 25,
                           font: { size: 13, weight: '500' },
                           boxWidth: 15,
                           usePointStyle: true,
                           pointStyle: 'rectRounded'
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                        titleColor: '#f1f5f9', 
                        bodyColor: '#cbd5e1', 
                        titleFont: { weight: 'bold', size: 14 },
                        bodyFont: { size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                        boxPadding: 5,
                        displayColors: true, 
                        callbacks: {
                            label: function(context: any) {
                                const currentItem = CURRENT_SORTED_DATA[context.dataIndex];
                                const pvStatusDisplay = currentItem?.pvStatus ? ` (${currentItem.pvStatus})` : '';
                                
                                let tooltipLines: string[] = [];
                                let datasetLabel = context.dataset.label || ''; 
                                
                                const itemName = context.label || '';
                                const val = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
                                let formattedVal = new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 2 }).format(val);

                                if (selectedValueColumn === 'Processing Speed') { 
                                    formattedVal += ' Days';
                                } else if (selectedValueColumn === 'Total') { 
                                    formattedVal = `\$${formattedVal}`;
                                }
                                
                                if (isPieOrDoughnut) {
                                    const total = context.chart.getDatasetMeta(0).data.reduce((acc: number,datapoint: any) => acc + (datapoint.outerRadius - datapoint.innerRadius > 0 ? context.chart.data.datasets[0].data[datapoint.$context.dataIndex] : 0) , 0) || 1; 
                                    const percentage = ((val / total) * 100).toFixed(1);
                                    tooltipLines.push(`${itemName}: ${formattedVal} (${percentage}%) ${pvStatusDisplay}`);
                                } else {
                                    tooltipLines.push(`${itemName}: ${datasetLabel}: ${formattedVal}${pvStatusDisplay}`);
                                }

                                if (!isPieOrDoughnut && currentItem) {
                                    const detailsToAdd = [
                                        { label: 'Requester', value: currentItem[REQUESTER_COLUMN_NAME] },
                                        { label: 'PV Code', value: currentItem[PV_CODE_FOR_DISPLAY_COLUMN_NAME] },
                                        { label: 'Create Date', value: formatDateForDisplay(currentItem[CREATE_DATE_COLUMN_NAME]) },
                                        { label: 'Paid Date', value: formatDateForDisplay(currentItem[PAID_DATE_COLUMN_NAME]) },
                                        { label: 'Paid By', value: currentItem[PAID_BY_COLUMN_NAME] },
                                        { label: 'Paid Method', value: currentItem[PV_CODE_COLUMN_NAME] },
                                        { label: 'Purpose', value: currentItem[PURPOSE_COLUMN_NAME] } 
                                    ];
                                    
                                    detailsToAdd.forEach(detail => {
                                        let displayValue = detail.value; 
                                
                                        if (detail.label !== 'Create Date' && detail.label !== 'Paid Date') {
                                            const stringValue = String(displayValue ?? '').trim();
                                            displayValue = stringValue === '' ? 'N/A' : stringValue;
                                        }
                                        // For date fields, displayValue is already formatted or 'N/A' from formatDateForDisplay.
                                        
                                        tooltipLines.push(`  ${detail.label}: ${displayValue}`);
                                    });
                                }
                                return tooltipLines;
                            }
                        }
                    }
                },
            }
        });
        if (fileUpload.files && fileUpload.files.length > 0 && 
            !messageArea.className.includes(MESSAGE_TYPE_CLASSES.error.split(' ')[0]) && 
            !messageArea.className.includes(MESSAGE_TYPE_CLASSES.info.split(' ')[0])) { 
             showMessage(`Chart updated: ${topNLabel} ${selectedLabelColumn} by ${valueColumnDisplay}.`, 'success');
        }
    } catch (error) {
        console.error("Chart.js error:", error);
        showMessage(`Failed to render chart: ${error instanceof Error ? error.message : String(error)}`, 'error');
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
    } finally {
        hideChartLoader();
        updateExportButtonsState();
    }
};

const generatePieColors = (count: number, border: boolean = false, hover: boolean = false): string[] => {
    const colorsToUse = hover ? MODERN_CHART_HOVER_COLORS : MODERN_CHART_COLORS;
    const borderColorValue = MODERN_CHART_BORDER_COLOR; 
    const resultColors = [];
    for (let i = 0; i < count; i++) {
        resultColors.push(border ? borderColorValue : colorsToUse[i % colorsToUse.length]);
    }
    return resultColors;
};


const handleFileUpload = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
        showMessage('No file selected. Please choose an Excel file.', 'info');
        SPREADSHEET_DATA = [];
        renderChart(SPREADSHEET_DATA); 
        updateExportButtonsState();
        return;
    }

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        showMessage('Invalid file type. Please upload an Excel file (.xlsx or .xls).', 'error');
        (event.target as HTMLInputElement).value = ''; 
        SPREADSHEET_DATA = [];
        renderChart(SPREADSHEET_DATA);
        updateExportButtonsState();
        return;
    }

    showMessage('Processing Excel file...', 'info');
    showChartLoader();
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = e.target?.result;
            if (!data) {
                showMessage('File data could not be read.', 'error');
                SPREADSHEET_DATA = [];
                renderChart(SPREADSHEET_DATA); 
                return;
            }
            // Add cellDates: true to parse dates into JS Date objects
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                showMessage('Excel sheet is empty or could not be parsed.', 'info');
                SPREADSHEET_DATA = [];
            } else {
                SPREADSHEET_DATA = jsonData;
            }
            renderChart(SPREADSHEET_DATA); 
        } catch (error) {
            console.error("Error processing Excel file:", error);
            showMessage(`Error processing file: ${error instanceof Error ? error.message : String(error)}`, 'error');
            SPREADSHEET_DATA = [];
            renderChart(SPREADSHEET_DATA); 
        }
    };

    reader.onerror = () => {
        showMessage('Error reading file. Ensure it is not corrupted.', 'error');
        SPREADSHEET_DATA = [];
        renderChart(SPREADSHEET_DATA); 
    };

    reader.readAsArrayBuffer(file);
};

const getJsPdfInstance = (orientation: 'portrait' | 'landscape' = 'portrait') => {
    if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
        console.error('jsPDF library not found. window.jspdf:', window.jspdf);
        showMessage('PDF export library (jsPDF) not available. Refresh page.', 'error');
        return null;
    }
    try {
        return new window.jspdf.jsPDF({ compress: true, orientation });
    } catch(e) {
        console.error("Error initializing jsPDF:", e);
        showMessage('Failed to initialize PDF exporter.', 'error');
        return null;
    }
};

const handleExportChartToPdf = async () => {
    if (!currentChart || (exportChartPdfButton && exportChartPdfButton.disabled)) {
        showMessage('No chart data or items to export.', 'info');
        return;
    }

    showMessage('Generating PDF Report (Landscape)...', 'info');
    if (exportChartPdfButton) exportChartPdfButton.disabled = true;
    if (exportExcelButton) exportExcelButton.disabled = true; 

    try {
        const doc = getJsPdfInstance('landscape');
        if (!doc) return;

        const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const selectedChartType = (document.querySelector('input[name="chartType"]:checked') as HTMLInputElement)?.value || 'bar';
        const chartTypeDisplay = selectedChartType.charAt(0).toUpperCase() + selectedChartType.slice(1);
        const valueColumnDisplay = getValueColumnDisplayString(selectedValueColumn);
        const topNLabel = selectedTopN === -1 ? 'All' : `Top ${selectedTopN}`;

        doc.setFontSize(18);
        doc.setTextColor('#1e3a8a'); 
        doc.text('Data Visualization Report', 14, 22);
        doc.setFontSize(10);
        doc.setTextColor('#475569'); 
        doc.text(`Generated on: ${currentDate}`, 14, 28);
        
        doc.setFontSize(14);
        doc.setTextColor('#1d4ed8'); 
        doc.text(`${chartTypeDisplay} Chart: ${topNLabel} "${selectedLabelColumn}" by "${valueColumnDisplay}"`, 14, 40);
        
        await new Promise(resolve => setTimeout(resolve, 250)); 
        const chartImgData = currentChart.toBase64Image('image/png', 0.95); 

        const imgProps = doc.getImageProperties(chartImgData);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        const availableWidth = pdfWidth - 2 * margin;
        
        let imgHeight = (imgProps.height * availableWidth) / imgProps.width;
        const maxChartHeight = doc.internal.pageSize.getHeight() * 0.65;
        if (imgHeight > maxChartHeight) {
            imgHeight = maxChartHeight;
        }
        doc.addImage(chartImgData, 'PNG', margin, 48, availableWidth, imgHeight, undefined, 'FAST');
        
        const filenameSafeValueDisplay = valueColumnDisplay.replace(/\s+/g, '_').replace(/[{}]/g, '');
        const filenameTopN = selectedTopN === -1 ? 'All_Items' : `Top_${selectedTopN}_Items`;
        doc.save(`Report_${filenameTopN}_${selectedLabelColumn}_by_${filenameSafeValueDisplay}_${new Date().toISOString().slice(0,10)}.pdf`);
        showMessage('Chart exported to PDF successfully!', 'success'); 

    } catch (error) {
        console.error("Error exporting Report to PDF:", error);
        showMessage(`Failed to export PDF Report: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
        updateExportButtonsState(); 
    }
};

const handleExportTopItemsToExcel = () => {
    if (CURRENT_SORTED_DATA.length === 0 || (exportExcelButton && exportExcelButton.disabled)) {
        showMessage('No items to export to Excel.', 'info');
        return;
    }
    
    showMessage('Generating Excel file...', 'info');
    if (exportChartPdfButton) exportChartPdfButton.disabled = true;
    if (exportExcelButton) exportExcelButton.disabled = true;

    try {
        const valueColumnDisplay = getValueColumnDisplayString(selectedValueColumn);
        const dataForExcel = CURRENT_SORTED_DATA.map((item, index) => {
            const row: any = {
                'Rank': index + 1,
                [selectedLabelColumn]: item[selectedLabelColumn] || 'Unnamed Item',
                [valueColumnDisplay]: parseFloat(item[selectedValueColumn]),
                'Status': item.pvStatus || 'N/A',
                'Created Date': item[CREATE_DATE_COLUMN_NAME], // JS Date object if parsed
                'Paid Date': item[PAID_DATE_COLUMN_NAME],      // JS Date object if parsed
                'Purpose': item[PURPOSE_COLUMN_NAME] || 'N/A' // Added Purpose
            };

            if (selectedValueColumn === 'Processing Speed') {
                row['Requester'] = item[REQUESTER_COLUMN_NAME];
                row['PV Code'] = item[PV_CODE_FOR_DISPLAY_COLUMN_NAME];
                row['Paid By'] = item[PAID_BY_COLUMN_NAME];
                row['Paid Method'] = item[PV_CODE_COLUMN_NAME];
            }
            return row;
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
        
        const columnWidths = Object.keys(dataForExcel[0] || {}).map(key => {
            let maxLen = key.length;
            dataForExcel.forEach(row => {
                const val = row[key];
                if (val !== null && val !== undefined) {
                    const len = (val instanceof Date) ? formatDateForDisplay(val).length : String(val).length;
                    if (len > maxLen) maxLen = len;
                }
            });
            return { wch: Math.min(Math.max(maxLen, 10), 50) }; 
        });
        worksheet['!cols'] = columnWidths;


        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Items List');
        
        const filenameSafeValueDisplay = valueColumnDisplay.replace(/\s+/g, '_').replace(/[{}]/g, '');
        const filenameTopN = selectedTopN === -1 ? 'All_Items' : `Top_${selectedTopN}_Items`;
        XLSX.writeFile(workbook, `${filenameTopN}_${selectedLabelColumn}_by_${filenameSafeValueDisplay}_${new Date().toISOString().slice(0,10)}.xlsx`);
        showMessage('Items list exported to Excel successfully!', 'success');

    } catch (error) {
        console.error("Error exporting to Excel:", error);
        showMessage(`Failed to export Excel: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
        updateExportButtonsState();
    }
};


fileUpload?.addEventListener('change', handleFileUpload);

chartTypeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        if (SPREADSHEET_DATA.length > 0 || (fileUpload.files && fileUpload.files.length > 0)) {
            renderChart(SPREADSHEET_DATA); 
        } else {
            if (currentChart) {
                 currentChart.destroy();
                 currentChart = null;
                 showMessage('Chart type changed. Upload an Excel file to see the visualization.', 'info');
                 updateExportButtonsState();
            }
        }
    });
});


topNSelect?.addEventListener('change', () => {
    if (SPREADSHEET_DATA.length > 0 || (fileUpload.files && fileUpload.files.length > 0)) {
        renderChart(SPREADSHEET_DATA);
    }
});

valueColumnSelect?.addEventListener('change', () => {
     if (SPREADSHEET_DATA.length > 0 || (fileUpload.files && fileUpload.files.length > 0)) {
        renderChart(SPREADSHEET_DATA);
    }
});

labelColumnSelect?.addEventListener('change', () => {
    if (SPREADSHEET_DATA.length > 0 || (fileUpload.files && fileUpload.files.length > 0)) {
        renderChart(SPREADSHEET_DATA);
    }
});

exportChartPdfButton?.addEventListener('click', handleExportChartToPdf);
exportExcelButton?.addEventListener('click', handleExportTopItemsToExcel);


const initializeApp = () => {
    selectedTopN = parseInt(topNSelect.value);
    selectedValueColumn = valueColumnSelect.value;
    selectedLabelColumn = labelColumnSelect.value;
    
    showMessage('Welcome! Upload an Excel file to visualize your data.', 'info');
    topItemsList.innerHTML = '<li class="text-slate-500 italic p-4 text-center bg-white rounded-md shadow-sm">Your top items will appear here after uploading a file.</li>';
    
    hideChartLoader(); 
    if (chartCanvas) chartCanvas.style.display = 'block';

    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
    updateExportButtonsState(); 
    renderChart(SPREADSHEET_DATA); 
};

initializeApp();

let arePanelsVisible = true; 

const togglePanelsVisibility = () => {
    if (!sidebarToggleButton || !mainContainerWrapper || !appNavbar || !appSidebar) {
        console.warn("Core layout elements for toggling panel visibility not found.");
        return;
    }

    arePanelsVisible = !arePanelsVisible;

    mainContainerWrapper.classList.toggle('panels-collapsed', !arePanelsVisible);

    if (arePanelsVisible) {
        sidebarToggleButton.setAttribute('aria-expanded', 'true');
        sidebarToggleButton.setAttribute('aria-label', 'Hide navigation and sidebar');
    } else {
        sidebarToggleButton.setAttribute('aria-expanded', 'false');
        sidebarToggleButton.setAttribute('aria-label', 'Show navigation and sidebar');
    }
};

if (sidebarToggleButton && mainContainerWrapper) {
    mainContainerWrapper.classList.remove('panels-collapsed');
    sidebarToggleButton.setAttribute('aria-expanded', 'true');
    sidebarToggleButton.setAttribute('aria-label', 'Hide navigation and sidebar');
    
    sidebarToggleButton.addEventListener('click', togglePanelsVisibility);
} else {
    console.warn("Sidebar toggle button or main container wrapper not found. Panel toggle functionality may not work.");
}


export {};