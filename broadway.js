const readXlsxFile = require('read-excel-file/node')
const path = require('path');
const xlsx = require("json-as-xlsx");
const { readdirSync } = require('fs');

const sheets = []
const failedFiles = []
let k = 0

async function run(p) {
  try {
    k++
    let lines = await readXlsxFile(p);

    if (!lines || lines.length === 0) {
      throw new Error('File is empty or could not be read');
    }

    const newName = '-' + p.split('\\').at(-1).split('.').at(-2)
      .replaceAll(/[\\\/\?\*\:\[\]]/g, '');
    
    let i = 0;
    let days = [];
    while (1) {
      const dateIndex = scanFor(lines, l => l[0]?.startsWith('[By Show, Venue, Ticket Type]'), i);
      if (dateIndex == null) break;
      i = dateIndex + 1;
      const nextDateIndex = scanFor(lines, l => l[0]?.startsWith('[By Show, Venue, Ticket Type]'), i);
      if (nextDateIndex != null && dateIndex >= nextDateIndex) continue;

      const date = lines[dateIndex][0].split(' ')[5];
      if (!date) {
        throw new Error('Could not find date in expected format');
      }

      const [y, m, d] = date.split('/');
      const gen = new Date(Date.UTC(1900, 0, 1, 12, 0, 0));
      const now = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0));
      const diff = Math.ceil((now-gen) / (1000 * 60 * 60 * 24)) + 2;

      j = i;
      while (1) {
        const showIndex = scanFor(lines, l => l[0]?.startsWith('Show'), j);
        if (!showIndex) break;
        j = showIndex + 1;
        if (nextDateIndex != null && showIndex >= nextDateIndex) break;
        if (lines[showIndex][0].split(' ').length != 2) continue;

        const showNo = lines[showIndex][0].split(' ')[1];
        if (isNaN(showNo)) continue;

        const totalIndex = scanFor(lines, l => l[0]?.startsWith('Show Total'), j + 1);
        if (!totalIndex || !lines[totalIndex] || !lines[totalIndex][2]) {
          continue; // Skip shows with missing data instead of failing
        }

        const showTotal = parseFloat(lines[totalIndex][2].toString().replace(/,/g, ''));
        if (isNaN(showTotal)) {
          continue; // Skip shows with invalid total
        }

        days.push({
          dateSerial: diff,
          showNo,
          showTotal
        });
      }
    }

    if (days.length === 0) {
      throw new Error('No valid show data found in file');
    }

    const cinema = lines[4]?.[0]?.split(' ').slice(0, -3).join(' ');
    if (!cinema) {
      throw new Error('Could not find cinema name');
    }

    const dateRange = lines[4][0].split(' ').slice(-3).join(' ');
    const movie = lines[9]?.[0];
    days[0].meta = dateRange;
    if (days.length <= 1) days.push({});
    days[1].meta = movie;

    sheets.push({
      sheet: k.toString(),
      columns: [
        {label: 'Date', value: 'dateSerial', format: 'dd-mmm-yy'},
        {label: 'Time', value: 'showNo'},
        {label: 'Box Office', value: 'showTotal'},
        {label: cinema, value: 'meta'}
      ],
      content: days
    });
    return true;
  } catch (error) {
    failedFiles.push({
      file: path.basename(p),
      error: error.message
    });
    return false;
  }
}

function scanFor(lines, condition, startIndex) {
  for(let i = startIndex; i < lines.length; i++) {
    if (condition(lines[i])) return i;
  }
  return null;
}

(async() => {
  try {
    const inputDir = path.join(__dirname, 'broadway-input');
    const inputs = readdirSync(inputDir);
    let totalProcessed = 0;
    
    for(const input of inputs) {
      if (input.toLowerCase().endsWith('.xlsx')) {
        const success = await run(path.join(__dirname, 'broadway-input', input));
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
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
})();