const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.join(__dirname, 'fixtures');
const output = path.join(outputDir, 'three-page-schedule.pdf');
fs.mkdirSync(outputDir, { recursive: true });

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << >> >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 8 0 R /Resources << >> >>',
  '<< /Length 0 >>\nstream\n\nendstream',
];

let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let index = 0; index < objects.length; index += 1) {
  offsets.push(Buffer.byteLength(pdf, 'ascii'));
  pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf, 'ascii');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(output, pdf, 'ascii');
console.log(output);
