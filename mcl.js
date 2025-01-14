const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const xlsx = require("json-as-xlsx");
const { readdirSync } = require('fs');

const sheets = [];
let k = 0;

// Create a debug log array to store all debug messages
const debugLogs = [];

// Debug helper function that stores structured data
function debugLog(label, data, indent = 0) {
  debugLogs.push({
    timestamp: new Date().toISOString(),
    level: 'DEBUG',
    label: label,
    indent: indent,
    data: data
  });
}

// Function to write debug logs to JSON file
function writeDebugLogs() {
  fs.writeFileSync(
    path.join(__dirname, 'mcl-debug.json'), 
    JSON.stringify(debugLogs, null, 2)
  );
}

function parseDate(dateStr) {
  // For content dates in M/D/YYYY format
  const [m, d, y] = dateStr.split('/');
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return date;
}

async function extractShowData(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  debugLog('First 20 lines of PDF:', lines.slice(0, 20));
  
  // Extract cinema and movie name
  const cinema = lines[0];  // First line is cinema name
  if (!cinema || cinema.length < 2) {
    throw new Error('Could not find cinema name in first line');
  }
  
  // Find movie name after header
  let movie = '';
  for (let i = 3; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (!isHeaderLine(line)) {
      movie = line;
      break;
    }
  }
  if (!movie) {
    throw new Error('Could not find movie name in first 10 lines');
  }
  
  debugLog('Cinema found:', cinema);
  debugLog('Movie found:', movie);
  
  const days = [];
  let currentDateStr = null;  // Keep the original date string
  let currentDate = null;     // Keep the parsed Date object
  let currentShowTime = null;
  let showData = {
    admits: [],
    amounts: []
  };

  let isDataContinuation = false;  // Flag to track data continuing from previous page
  let lastValidAdmits = null;      // Track last valid admits for continuity check

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip known non-data lines and page breaks
    if (isHeaderLine(line) || 
        line.includes('Page Total') || 
        line.includes('Grand Total') ||
        line.includes('Detailed Distributors Report')) {
      isDataContinuation = line.includes('Detailed Distributors Report');  // Mark start of new page
      continue;
    }

    // Match date pattern (e.g., "7/18/2024")
    const dateMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4})$/);
    if (dateMatch) {
      // Check if this is a footer date
      const isFooterDate = i > 0 && (
        lines[i-1].includes('Total for Film this Screen') ||
        lines[i-1].includes('Day Total') ||
        lines[i+1].includes('Detailed Distributors Report') ||
        lines[i+1].includes('© Vista Entertainment')
      );

      if (isFooterDate) {
        continue;  // Skip footer dates
      }

      // If we're in the middle of processing a show and see a new date,
      // check if it's actually a continuation from a page break
      if (currentShowTime && showData.admits.length > 0 && !showData.amounts.length) {
        // This might be a page break - keep current show data
        continue;
      }

      try {
        currentDateStr = dateMatch[1];
        currentDate = parseDate(currentDateStr);
        showData = { admits: [], amounts: [] };
        debugLog('Found date:', {
          original: currentDateStr,
          parsed: currentDate.toDateString(),
          isFooterDate,
          isDataContinuation
        });
      } catch (error) {
        throw new Error(`Invalid date on line ${i + 1}: ${error.message}`);
      }
      continue;
    }

    // Match show time (e.g., "10:30")
    const timeMatch = line.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      if (!currentDate) {
        // If we have no date but we're continuing from previous page,
        // keep processing with the last valid date
        if (!isDataContinuation) {
          throw new Error(`Found time ${line} on line ${i + 1} but no valid date was set`);
        }
      }
      
      // Process previous show data if exists
      if (currentShowTime && showData.admits.length > 0 && showData.amounts.length > 0) {
        processShowData(days, currentDateStr, currentShowTime, showData, i);
      }
      
      currentShowTime = timeMatch[1] + ':' + timeMatch[2];
      showData = { admits: [], amounts: [] };
      debugLog('Found show time:', currentShowTime, 2);
      continue;
    }

    // Match amount pattern (e.g., "370.00")
    const amountMatch = line.match(/^([\d,]+\.\d{2})$/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      showData.amounts.push(amount);
      debugLog('Found amount:', amount, 4);
    }

    // Match admits pattern (just a number by itself)
    const admitsMatch = line.match(/^(\d+)$/);
    if (admitsMatch && !line.includes('/')) {  // Exclude dates
      const admits = parseInt(admitsMatch[1]);
      showData.admits.push(admits);
      debugLog('Found admits:', admits, 4);
    }

    // Modify the "Day Total" handling to be more robust
    if (line.includes('Day Total')) {
      if (currentShowTime && showData.admits.length > 0) {
        // If we have admits but no amounts, this might be a page break
        // Don't process the show yet, wait for the amounts on next page
        if (showData.amounts.length === 0) {
          lastValidAdmits = showData.admits;
          continue;
        }
        
        const showTotal = showData.amounts[showData.amounts.length - 1];
        const showAdmits = showData.admits[showData.admits.length - 1];
        
        if (currentDateStr && currentShowTime && showAdmits && showTotal) {
          const [m, d, y] = currentDateStr.split('/');  // Use the string version
          const gen = new Date(1900, 0, 1);
          const now = new Date(y, m - 1, d);
          const diff = Math.ceil((now - gen) / (1000 * 60 * 60 * 24)) + 1;

          days.push({
            dateSerial: diff,
            showNo: currentShowTime.replace(':', ''),
            showTotal: showTotal,
            admits: showAdmits
          });

          debugLog('Added show:', {
            date: currentDate.toDateString(),
            time: currentShowTime,
            admits: showAdmits,
            total: showTotal
          }, 4);
        }
      }
      showData = { admits: [], amounts: [] };
    }
  }

  debugLog('Total shows found:', days.length);
  debugLog('All processed shows:', days);

  // Add metadata to first two entries
  if (days.length > 0) {
    days[0].meta = cinema;
    if (days.length > 1) {
      days[1].meta = movie;
    }
  }

  return days;
}

// Helper functions
function isHeaderLine(line) {
  return line === 'Detailed Distributors Report' || 
         line.includes('From Thursday') ||
         line.includes('Golden Scene Company') ||
         line === 'Ticket Type' ||
         line === 'Admits' ||
         line === 'Total Amount' ||
         line.includes('Detail Level:') ||
         line.includes('House') ||
         !line;
}

function processShowData(days, currentDateStr, currentShowTime, showData, lineNum) {
  const showTotal = showData.amounts[showData.amounts.length - 1];
  const showAdmits = showData.admits[showData.admits.length - 1];
  
  // Allow zero values, but ensure the values are actually present
  if (showTotal === undefined || showAdmits === undefined) {
    throw new Error(`Invalid show data at line ${lineNum}: missing total or admits`);
  }

  // Convert date to Excel serial number using the date string
  const [m, d, y] = currentDateStr.split('/');
  const gen = new Date(1900, 0, 1);
  const now = new Date(y, m - 1, d);
  const diff = Math.ceil((now - gen) / (1000 * 60 * 60 * 24)) + 1;

  days.push({
    dateSerial: diff,
    showNo: currentShowTime.replace(':', ''),
    showTotal: showTotal,
    admits: showAdmits
  });

  debugLog('Added show:', {
    date: now.toDateString(),
    time: currentShowTime,
    admits: showAdmits,
    total: showTotal
  }, 4);
}

// Add at the top with other global variables
const failedFiles = [];

async function processPDF(filePath) {
  try {
    k++;
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    const days = await extractShowData(data.text);
    const cinema = days[0]?.meta || 'Unknown Cinema';
    
    sheets.push({
      sheet: k.toString(),
      columns: [
        { label: 'Date', value: 'dateSerial', format: 'dd-mmm-yy' },
        { label: 'Time', value: 'showNo' },
        { label: 'Box Office', value: 'showTotal' },
        { label: cinema, value: 'meta' }
      ],
      content: days
    });

    debugLog('Sheet added:', {
      sheetNumber: k,
      rowCount: days.length,
      cinema
    });
    return true;
  } catch (error) {
    failedFiles.push({
      file: path.basename(filePath),
      error: error.message
    });
    debugLog('File Processing Error', {
      file: path.basename(filePath),
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

// Modify the main execution block
(async () => {
  try {
    debugLog('Process Start', 'Starting PDF processing...');
    
    const inputDir = path.join(__dirname, 'mcl-input');
    const inputs = readdirSync(inputDir);
    let totalProcessed = 0;
    
    debugLog('Found input files', inputs);
    
    for (const input of inputs) {
      if (input.toLowerCase().endsWith('.pdf')) {
        const success = await processPDF(path.join(inputDir, input));
        if (success) totalProcessed++;
      }
    }

    // Generate error report if needed
    if (failedFiles.length > 0) {
      console.error('\n⚠️  WARNING: Some files failed to process ⚠️');
      console.error('Failed files:');
      failedFiles.forEach(({ file, error }) => {
        console.error(`❌ ${file}: ${error}`);
      });
      console.error(`\nProcessed ${totalProcessed} out of ${inputs.length} files successfully.`);
    }

    if (totalProcessed > 0) {
      await xlsx(sheets, {
        fileName: 'output'
      });
    } else {
      throw new Error('No files were processed successfully');
    }
    
    writeDebugLogs();
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    debugLog('Fatal Error', {
      message: error.message,
      stack: error.stack
    });
    writeDebugLogs();
    process.exit(1);
  }
})();
