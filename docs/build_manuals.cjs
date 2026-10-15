const fs = require('fs');
const path = require('path');
const { Packer } = require('docx');

const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const jobs = [
    ['事務管理システム_事務局マニュアル.docx', require('./manual_admin.cjs')],
    ['勤怠システム_職員マニュアル.docx', require('./manual_staff.cjs')],
  ];
  for (const [name, doc] of jobs) {
    const buf = await Packer.toBuffer(doc);
    const file = path.join(out, name);
    fs.writeFileSync(file, buf);
    console.log(`${name}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
