const readXlsxFile = require('read-excel-file/node')
const path = require('path');
const xlsx = require("json-as-xlsx");
const { readdirSync } = require('fs');

const sheets = []

k = 0

async function run(p){
  k++
  let lines = await readXlsxFile(p);

  newName = '-' + p.split('\\').at(-1).split('.').at(-2)
  newName = newName.replaceAll(/[\\\/\?\*\:\[\]]/g, '')
  
  i = 0
  let days = []
  while (1){
    const dateIndex = scanFor(lines, l => l[0]?.startsWith('[By Show, Venue, Ticket Type]'), i)
    if(dateIndex == null) break
    i = dateIndex + 1
    const nextDateIndex = scanFor(lines, l => l[0]?.startsWith('[By Show, Venue, Ticket Type]'), i);
    if(nextDateIndex != null && dateIndex >= nextDateIndex) continue;

    const date = lines[dateIndex][0].split(' ')[5]
    const [y, m, d] = date.split('/')
    const gen = new Date(1900, 0, 1)
    const now = new Date(y, m - 1, d)
    const diff = Math.ceil((now-gen) / (1000 * 60 * 60 * 24)) + 2
    // console.log(gen, now, diff)
    // console.log(Math.ceil((new Date(2011, 7, 22)-gen) / (1000 * 60 * 60 * 24)) + 2)
    j = i
    while (1){
      const showIndex = scanFor(lines, l => l[0]?.startsWith('Show'), j);
      if(!showIndex) break;
      j = showIndex + 1
      if(nextDateIndex != null && showIndex >= nextDateIndex) break;
      if(lines[showIndex][0].split(' ').length != 2) continue;

      const showNo = lines[showIndex][0].split(' ')[1]
      if(isNaN(showNo)) continue;

      const totalIndex = scanFor(lines, l => l[0]?.startsWith('Show Total'), j + 1);
      const showTotal = parseFloat(lines[totalIndex][2].toString().replace(/,/g, ''));

      days.push({
        dateSerial: diff, 
        showNo, 
        showTotal
      })
    }
  }

  const cinema = lines[4][0].split(' ').slice(0, -3).join(' ')
  const dateRange = lines[4][0].split(' ').slice(-3).join(' ')
  const movie = lines[9][0]
  days[0].meta = dateRange
  if(days.length <= 1) days.push({})
  days[1].meta = movie
  // await writeFile(path.join(__dirname, 'sheet.json'), JSON.stringify(days, null, 2))
  sheets.push(
    {
      sheet: k.toString(),
      columns: [
        {label: 'Date', value: 'dateSerial', format: 'dd-mmm-yy'},
        {label: 'Time', value: 'showNo'},
        {label: 'Box Office', value: 'showTotal'},
        {label: cinema, value: 'meta'}
      ],
      content: days
    }
  )
  console.log(p.split('\\').at(-1))
}

function scanFor(lines, condition, startIndex){
  for(let i = startIndex; i < lines.length; i++){
    if (condition(lines[i])) return i
  }
  return null
}

(async() => {
  const inputs = readdirSync(path.join(__dirname, 'input'))
  
  for(const input of inputs){
    await run(path.join(__dirname, 'input', input))
  }

  await xlsx(sheets, {
    fileName: 'output'
  })
})()