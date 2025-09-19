const express = require('express');
const app = express();

app.use(express.json());

// Auth routes
app.post('/login', require('./routes/auth').login);
app.get('/password/reset', require('./routes/auth').resetPassword);

// Project routes
app.get('/projects', require('./routes/project').list);
app.post('/projects', require('./routes/project').create);
app.get('/projects/:id/prestacao-contas', require('./routes/project').prestacaoContas);

// Financial documentation
app.get('/projects/:id/financeiro', require('./routes/financeiro').list);
app.post('/projects/:id/financeiro', require('./routes/financeiro').add);
app.put('/projects/:id/financeiro/:linha_id', require('./routes/financeiro').update);
app.delete('/projects/:id/financeiro/:linha_id', require('./routes/financeiro').remove);
app.post('/import-documents', require('./routes/ocr').importDocuments);

// Document Automation
app.post('/documentos/gerar/folha-rosto', require('./routes/documentos').gerarFolhaRosto);
app.post('/documentos/gerar/nota-debito', require('./routes/documentos').gerarNotaDebito);
app.post('/documentos/gerar/mapa-cotacao', require('./routes/documentos').gerarMapaCotacao);

// Final Package
app.get('/projects/:id/pacote-final', require('./routes/pacotefinal').list);
app.get('/projects/:id/pacote-final/organizar', require('./routes/pacotefinal').organizar);
app.get('/projects/:id/pacote-final/download-pdf-unico', require('./routes/pacotefinal').downloadPdfUnico);
app.get('/projects/:id/pacote-final/download-zip', require('./routes/pacotefinal').downloadZip);

// Admin
app.post('/admin/templates/upload', require('./routes/admin').uploadTemplate);
app.post('/admin/rubricas', require('./routes/admin').createRubrica);
app.get('/admin/rubricas', require('./routes/admin').listRubricas);
app.get('/admin/users', require('./routes/admin').listUsers);

// Profile
app.put('/profile', require('./routes/profile').update);
app.put('/profile/password', require('./routes/profile').changePassword);
app.put('/profile/preferences', require('./routes/profile').preferences);

app.listen(3000, () => console.log('API rodando na porta 3000'));
module.exports = app;
