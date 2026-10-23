require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createPool } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');
const app = express(), db = createPool(), PORT = Number(process.env.PORT || 3000);
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s=>s.trim()).filter(Boolean);
app.disable('x-powered-by'); app.use(helmet());
app.use(cors({origin(origin, cb) { if (!origin || !origins.length || origins.includes(origin)) return cb(null,true); cb(new Error('Origem não permitida pelo CORS.')); }}));
app.use(express.json({limit:'100kb'}));
const route = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const idOf = x => /^[1-9]\d*$/.test(String(x)) && Number.isSafeInteger(Number(x)) ? Number(x) : null;
const projectSQL = `SELECT p.id,p.nome,p.tipo,p.fluxo_continuo,p.identificador,p.coordenador_id,pe.nome AS coordenador,p.edital_id,e.numero AS edital_numero,e.orgao AS edital_orgao,e.titulo AS edital_titulo,p.inicio,p.termino,p.financiado,p.valor,CASE WHEN p.inicio IS NULL OR p.termino IS NULL THEN 'sem datas' WHEN CURDATE()<p.inicio THEN 'programado' WHEN CURDATE()>p.termino THEN 'concluído' ELSE 'em andamento' END AS status FROM projeto p LEFT JOIN pessoa pe ON pe.id=p.coordenador_id LEFT JOIN edital e ON e.id=p.edital_id`;
function validateProject(b) {
  const errors=[], types=['Pesquisa','Extensão','Ensino'];
  if(typeof b.nome!=='string'||!b.nome.trim()||b.nome.trim().length>400) errors.push('nome é obrigatório e aceita até 400 caracteres.');
  if(!types.includes(b.tipo)) errors.push('tipo deve ser Pesquisa, Extensão ou Ensino.');
  for(const k of ['fluxo_continuo','financiado']) if(b[k]!==undefined&&typeof b[k]!=='boolean') errors.push(`${k} deve ser booleano.`);
  if(b.identificador!=null&&(typeof b.identificador!=='string'||b.identificador.trim().length>20)) errors.push('identificador deve ter até 20 caracteres ou ser null.');
  for(const k of ['inicio','termino']) if(b[k]!=null&&(typeof b[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b[k])||Number.isNaN(Date.parse(b[k]+'T00:00:00Z')))) errors.push(`${k} deve estar no formato AAAA-MM-DD ou ser null.`);
  if(b.inicio&&b.termino&&b.termino<b.inicio) errors.push('termino não pode ser anterior a inicio.');
  if(b.valor!=null&&(!Number.isFinite(Number(b.valor))||Number(b.valor)<0)) errors.push('valor deve ser um número não negativo ou null.');
  for(const k of ['coordenador_id','edital_id']) if(b[k]!=null&&!idOf(b[k])) errors.push(`${k} deve ser ID positivo ou null.`);
  return errors;
}
app.get('/',(req,res)=>res.json({nome:'NOCS Lab API',versao:'1.0.0'}));
app.get('/health',route(async(req,res)=>{await db.query('SELECT 1');res.json({status:'ok',banco:'conectado'});}));
app.post('/api/auth/login',route(async(req,res)=>{
  const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():''; const senha=typeof req.body.senha==='string'?req.body.senha:'';
  if(!email||!senha)return res.status(400).json({erro:'Informe email e senha.'});
  const [rows]=await db.execute('SELECT u.pessoa_id,u.email,u.senha_hash,u.perfil,u.ativo,p.nome FROM usuario u JOIN pessoa p ON p.id=u.pessoa_id WHERE LOWER(u.email)=LOWER(?) LIMIT 1',[email]); const u=rows[0];
  if(!u||!u.ativo||!(await bcrypt.compare(senha,u.senha_hash)))return res.status(401).json({erro:'Email ou senha inválidos.'});
  const token=jwt.sign({pessoa_id:u.pessoa_id,email:u.email,nome:u.nome,perfil:u.perfil},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
  res.json({token,tipo:'Bearer',expira_em:process.env.JWT_EXPIRES_IN||'8h',usuario:{pessoa_id:u.pessoa_id,email:u.email,nome:u.nome,perfil:u.perfil}});
}));
app.get('/api/projetos',route(async(req,res)=>{
  const where=[],params=[];
  if(req.query.tipo){where.push('p.tipo=?');params.push(req.query.tipo);}
  if(req.query.coordenador_id){const id=idOf(req.query.coordenador_id);if(!id)return res.status(400).json({erro:'coordenador_id inválido.'});where.push('p.coordenador_id=?');params.push(id);}
  if(req.query.financiado!==undefined){if(!['true','false','1','0'].includes(String(req.query.financiado)))return res.status(400).json({erro:'financiado deve ser true ou false.'});where.push('p.financiado=?');params.push(['true','1'].includes(String(req.query.financiado))?1:0);}
  if(req.query.q){const q='%'+String(req.query.q).trim().slice(0,150)+'%';where.push('(p.nome LIKE ? OR p.identificador LIKE ? OR pe.nome LIKE ? OR e.numero LIKE ? OR e.orgao LIKE ? OR e.titulo LIKE ?)');params.push(q,q,q,q,q,q);}
  if(req.query.status){const valid=['sem datas','programado','concluído','em andamento'];if(!valid.includes(req.query.status))return res.status(400).json({erro:'status inválido.'});where.push(`CASE WHEN p.inicio IS NULL OR p.termino IS NULL THEN 'sem datas' WHEN CURDATE()<p.inicio THEN 'programado' WHEN CURDATE()>p.termino THEN 'concluído' ELSE 'em andamento' END=?`);params.push(req.query.status);}
  const [rows]=await db.execute(projectSQL+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY p.inicio IS NULL,p.inicio DESC,p.nome ASC',params);res.json({total:rows.length,projetos:rows});
}));
app.get('/api/projetos/:id',route(async(req,res)=>{const id=idOf(req.params.id);if(!id)return res.status(400).json({erro:'ID inválido.'});const [r]=await db.execute(projectSQL+' WHERE p.id=?',[id]);if(!r.length)return res.status(404).json({erro:'Projeto não encontrado.'});res.json(r[0]);}));
app.post('/api/projetos',requireAuth,route(async(req,res)=>{const b=req.body,errors=validateProject(b);if(errors.length)return res.status(400).json({erro:'Dados inválidos.',detalhes:errors});const [r]=await db.execute('INSERT INTO projeto(nome,tipo,fluxo_continuo,identificador,coordenador_id,edital_id,inicio,termino,financiado,valor) VALUES(?,?,?,?,?,?,?,?,?,?)',[b.nome.trim(),b.tipo,b.fluxo_continuo??false,b.identificador?.trim()||null,b.coordenador_id??null,b.edital_id??null,b.inicio??null,b.termino??null,b.financiado??false,b.valor??null]);const [rows]=await db.execute(projectSQL+' WHERE p.id=?',[r.insertId]);res.status(201).json(rows[0]);}));
app.put('/api/projetos/:id',requireAuth,route(async(req,res)=>{const id=idOf(req.params.id);if(!id)return res.status(400).json({erro:'ID inválido.'});const b=req.body,errors=validateProject(b);if(errors.length)return res.status(400).json({erro:'Dados inválidos.',detalhes:errors});const [r]=await db.execute('UPDATE projeto SET nome=?,tipo=?,fluxo_continuo=?,identificador=?,coordenador_id=?,edital_id=?,inicio=?,termino=?,financiado=?,valor=? WHERE id=?',[b.nome.trim(),b.tipo,b.fluxo_continuo??false,b.identificador?.trim()||null,b.coordenador_id??null,b.edital_id??null,b.inicio??null,b.termino??null,b.financiado??false,b.valor??null,id]);if(!r.affectedRows){const [found]=await db.execute('SELECT id FROM projeto WHERE id=?',[id]);if(!found.length)return res.status(404).json({erro:'Projeto não encontrado.'});}const [rows]=await db.execute(projectSQL+' WHERE p.id=?',[id]);res.json(rows[0]);}));
app.delete('/api/projetos/:id',requireAuth,requireAdmin,route(async(req,res)=>{const id=idOf(req.params.id);if(!id)return res.status(400).json({erro:'ID inválido.'});const [r]=await db.execute('DELETE FROM projeto WHERE id=?',[id]);if(!r.affectedRows)return res.status(404).json({erro:'Projeto não encontrado.'});res.status(204).end();}));
app.get('/api/editais',route(async(req,res)=>{const [r]=await db.execute('SELECT e.id,e.numero,e.orgao,e.titulo,COUNT(p.id) AS total_projetos FROM edital e LEFT JOIN projeto p ON p.edital_id=e.id GROUP BY e.id,e.numero,e.orgao,e.titulo ORDER BY e.orgao,e.numero');res.json({total:r.length,editais:r});}));
app.post('/api/editais',requireAuth,route(async(req,res)=>{const numero=typeof req.body.numero==='string'?req.body.numero.trim():'';const orgao=req.body.orgao,titulo=req.body.titulo==null?null:String(req.body.titulo).trim();if(!numero||numero.length>10||!['PROPI','PROEX','PROEN','DG/PAR'].includes(orgao)||(titulo&&titulo.length>300))return res.status(400).json({erro:'Informe número, órgão válido e título opcional.'});const [r]=await db.execute('INSERT INTO edital(numero,orgao,titulo) VALUES(?,?,?)',[numero,orgao,titulo||null]);const [rows]=await db.execute('SELECT id,numero,orgao,titulo FROM edital WHERE id=?',[r.insertId]);res.status(201).json(rows[0]);}));
app.get('/api/pessoas',route(async(req,res)=>{const [r]=await db.execute('SELECT p.id,p.nome,COUNT(pr.id) AS projetos_coordenados FROM pessoa p LEFT JOIN projeto pr ON pr.coordenador_id=p.id GROUP BY p.id,p.nome ORDER BY p.nome');res.json({total:r.length,pessoas:r});}));
app.post('/api/pessoas',requireAuth,route(async(req,res)=>{const nome=typeof req.body.nome==='string'?req.body.nome.trim():'';if(!nome||nome.length>120)return res.status(400).json({erro:'nome é obrigatório e aceita até 120 caracteres.'});const [r]=await db.execute('INSERT INTO pessoa(nome) VALUES(?)',[nome]);res.status(201).json({id:r.insertId,nome});}));
app.post('/api/usuarios',requireAuth,requireAdmin,route(async(req,res)=>{const pessoaId=idOf(req.body.pessoa_id),email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'',senha=typeof req.body.senha==='string'?req.body.senha:'',perfil=req.body.perfil||'editor';if(!pessoaId||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||senha.length<12||!['admin','editor'].includes(perfil))return res.status(400).json({erro:'Informe pessoa_id, email válido, senha de 12+ caracteres e perfil admin/editor.'});const hash=await bcrypt.hash(senha,12);await db.execute('INSERT INTO usuario(pessoa_id,email,senha_hash,perfil,ativo) VALUES(?,?,?,?,TRUE)',[pessoaId,email,hash,perfil]);res.status(201).json({pessoa_id:pessoaId,email,perfil,ativo:true});}));
app.patch('/api/usuarios/:pessoaId/ativo',requireAuth,requireAdmin,route(async(req,res)=>{const id=idOf(req.params.pessoaId);if(!id||typeof req.body.ativo!=='boolean')return res.status(400).json({erro:'Informe ID válido e ativo booleano.'});const [r]=await db.execute('UPDATE usuario SET ativo=? WHERE pessoa_id=?',[req.body.ativo,id]);if(!r.affectedRows)return res.status(404).json({erro:'Usuário não encontrado.'});res.json({pessoa_id:id,ativo:req.body.ativo});}));
app.use((req,res)=>res.status(404).json({erro:'Endpoint não encontrado.'}));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.code==='ER_DUP_ENTRY')return res.status(409).json({erro:'Já existe um registro com valor único duplicado.'});if(err.code==='ER_NO_REFERENCED_ROW_2')return res.status(400).json({erro:'A pessoa coordenadora ou o edital informado não existe.'});if(err.code==='ER_CHECK_CONSTRAINT_VIOLATED')return res.status(400).json({erro:'Os dados violam uma regra do banco.'});if(err.message==='Origem não permitida pelo CORS.')return res.status(403).json({erro:err.message});console.error(err);res.status(500).json({erro:'Erro interno do servidor.'});});
const server=app.listen(PORT,()=>console.log(`NOCS Lab API escutando na porta ${PORT}`));
async function shutdown(){server.close();await db.end();process.exit(0);}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
