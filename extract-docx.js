const mammoth = require('mammoth');
const fs = require('fs');

mammoth.extractRawText({ path: "C:/Users/CoryD/Downloads/sched app.docx" })
    .then(function (result) {
        fs.writeFileSync('docx-content.txt', result.value, 'utf8');
        console.log('Content saved to docx-content.txt');
        console.log('Length:', result.value.length);
    })
    .catch(function (error) {
        console.error('Error:', error);
    });
