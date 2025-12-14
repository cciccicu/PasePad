const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const Database = require('better-sqlite3');
const session = require('express-session');

/**
 * 将 UTC 日期格式化为 UTC+8 的 YYYY/MM/DD hh:mm:ss 格式
 * @param {Date|string} date - 日期对象或日期字符串（应为 UTC 时间）
 * @returns {string} 格式化后的 UTC+8 日期字符串
 */
function formatDateTime(date) {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  // 将时间转为 UTC 时间戳，再加 8 小时（28800000 毫秒）
  const utcTime = d.getTime();
  const utcPlus8Time = utcTime + 8 * 60 * 60 * 1000;
  const d8 = new Date(utcPlus8Time);

  const year = d8.getFullYear();
  const month = String(d8.getMonth() + 1).padStart(2, '0');
  const day = String(d8.getDate()).padStart(2, '0');
  const hours = String(d8.getHours()).padStart(2, '0');
  const minutes = String(d8.getMinutes()).padStart(2, '0');
  const seconds = String(d8.getSeconds()).padStart(2, '0');
  
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 读取配置文件
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    // 默认配置
    config = {
      auth: { password: 'PasePad' },
      upload: {
        uploadDir: './uploads',
        vditoruploadsDir: './vditoruploads'
      },
      fileSync: {
        dbMissingFile: 'keep',
        fileMissingDb: 'keep'
      }
    };
    // 创建默认配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
} catch (err) {
  console.error('读取配置文件失败:', err);
  // 默认配置
  config = {
    auth: { password: 'Abc@123' },
    upload: {
      uploadDir: './uploads',
      vditoruploadsDir: './vditoruploads'
    },
    fileSync: {
      dbMissingFile: 'keep',
      fileMissingDb: 'keep'
    }
  };
}

// 初始化应用
const app = express();
const port = process.env.PORT || 3000;

// 解析上传目录路径（支持相对路径和绝对路径）
function resolvePath(dirPath) {
  if (path.isAbsolute(dirPath)) {
    return dirPath;
  }
  return path.join(__dirname, dirPath.replace(/^\.\//, ''));
}

// 确保上传目录存在
const uploadDir = resolvePath(config.upload.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 确保vditor上传目录存在
const vditoruploadsDir = resolvePath(config.upload.vditoruploadsDir);
if (!fs.existsSync(vditoruploadsDir)) {
  fs.mkdirSync(vditoruploadsDir, { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 使用Buffer处理文件名，确保中文字符正确编码
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    
    // 检查文件是否已存在，如果存在则添加序号
    let fileName = originalName;
    let fileNameWithoutExt = originalName;
    let extension = '';
    
    // 提取文件扩展名
    const lastDotIndex = originalName.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      fileNameWithoutExt = originalName.substring(0, lastDotIndex);
      extension = originalName.substring(lastDotIndex);
    }
    
    // 检查文件是否存在，如果存在则添加序号
    let counter = 1;
    while (fs.existsSync(path.join(uploadDir, fileName))) {
      fileName = `${fileNameWithoutExt} (${counter})${extension}`;
      counter++;
    }
    
    cb(null, fileName);
  }
});
const upload = multer({ storage: storage });

// 配置Vditor图片上传
const vditorStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, vditoruploadsDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, uniqueSuffix + extension);
  }
});

// 限制Vditor只能上传图片和音频文件
const vditorFileFilter = function(req, file, cb) {
  // 检查文件MIME类型
  const allowedMimeTypes = [
    // 图片类型
    'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml',
    // 音频类型
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/aac', 'audio/flac'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    // 接受文件
    cb(null, true);
  } else {
    // 拒绝文件
    cb(new Error('只允许上传图片和音频文件'), false);
  }
};

const vditorUpload = multer({ 
  storage: vditorStorage,
  fileFilter: vditorFileFilter
});

// 配置视图引擎和静态文件
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use('/vditor', express.static(resolvePath(config.upload.vditoruploadsDir)));

// 配置会话
app.use(session({
  secret: 'nd-clipboard-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 3600000 } // 会话有效期1小时
}));

// 认证中间件
const authMiddleware = (req, res, next) => {
  if (req.session.authenticated) {
    return next();
  }
  return res.status(403).json({ error: '未授权访问' });
};

// 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 初始化数据库
const dbPath = path.join(__dirname, 'clipboard.db');
let db;

try {
  db = new Database(dbPath);
  console.log('已连接到SQLite数据库');
  
  // 创建剪贴板表
  db.exec(`CREATE TABLE IF NOT EXISTS clipboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log('剪贴板表已创建或已存在');
} catch (err) {
  console.error('数据库连接错误:', err.message);
}

// 路由

// 首页 - 显示所有剪贴板项目
app.get('/', (req, res) => {
  // 检查URL中是否有密码参数
  const { password } = req.query;
  if (password === config.auth.password) {
    req.session.authenticated = true;
  }
  
  try {
    // 按照创建时间降序排序，确保最新的项目显示在最前面
    const rows = db.prepare(`SELECT * FROM clipboard ORDER BY created_at DESC`).all();
    res.render('index', { 
      items: rows, 
      authenticated: req.session.authenticated || false,
      formatDateTime: formatDateTime
    });
  } catch (err) {
    return res.status(500).send('数据库错误: ' + err.message);
  }
});

// 创建新的剪贴板项目 - 富文本(Markdown)
app.post('/create/markdown', (req, res) => {
  const { title, content } = req.body;
  try {
    db.prepare(`INSERT INTO clipboard (type, title, content) VALUES (?, ?, ?)`)
      .run('markdown', title, content);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 创建新的剪贴板项目 - 纯文本
app.post('/create/text', (req, res) => {
  const { title, content } = req.body;
  try {
    db.prepare(`INSERT INTO clipboard (type, title, content) VALUES (?, ?, ?)`)
      .run('text', title, content);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 创建新的剪贴板项目 - 链接
app.post('/create/link', (req, res) => {
  const { title, content } = req.body;
  try {
    db.prepare(`INSERT INTO clipboard (type, title, content) VALUES (?, ?, ?)`)
      .run('link', title, content);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 创建新的剪贴板项目 - 文件
app.post('/create/file', upload.single('file'), (req, res) => {
  // 使用文件原始名称作为标题（如果没有提供标题）
  let { title, original_filename } = req.body;
  
  // 确保文件名编码正确
  if (req.file) {
    // 处理可能的编码问题
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (!title) {
      title = originalName;
    }
    // 使用处理后的原始文件名
    original_filename = original_filename || originalName;
  }
  
  // 只存储相对路径格式，保持一致性
  // 无论上传目录如何配置，数据库中始终使用'uploads/filename'格式
  const filePath = req.file ? 'uploads/' + path.basename(req.file.path) : null;
  
  try {
    db.prepare(`INSERT INTO clipboard (type, title, file_path) VALUES (?, ?, ?)`)
      .run('file', title, filePath);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 获取单个剪贴板项目
app.get('/item/:id', (req, res) => {
  const id = req.params.id;
  try {
    const row = db.prepare(`SELECT * FROM clipboard WHERE id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: '项目未找到' });
    }
    res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 分享页面 - 显示单个剪贴板项目
app.get('/share/:id', (req, res) => {
  const id = req.params.id;
  try {
    const row = db.prepare(`SELECT * FROM clipboard WHERE id = ?`).get(id);
    if (!row) {
      return res.render('share', { item: null, formatDateTime: formatDateTime });
    }
    res.render('share', { item: row, formatDateTime: formatDateTime });
  } catch (err) {
    console.error('分享页面错误:', err.message);
    return res.render('share', { item: null, formatDateTime: formatDateTime });
  }
});

// 获取文件信息
app.get('/file-info/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('SELECT * FROM clipboard WHERE id = ? AND type = \'file\'');
    const item = stmt.get(id);
    
    if (!item || !item.file_path) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    // 获取文件的完整路径，处理相对路径
    // 从数据库中获取的file_path格式为'uploads/filename'，需要提取实际文件名
    const filename = path.basename(item.file_path);
    const filePath = path.join(resolvePath(config.upload.uploadDir), filename);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    // 获取文件信息
    const stats = fs.statSync(filePath);
    const fileInfo = {
      name: path.basename(filePath),
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      type: getFileType(filePath)
    };
    
    res.json(fileInfo);
  } catch (err) {
    console.error('获取文件信息失败:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取文件类型
function getFileType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    // 图片类型
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    // 视频类型
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    // 音频类型
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    // 文档类型
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 纯文本类型
    '.txt': 'text/plain',
    '.xml': 'text/xml',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.py': 'text/x-python',
    '.java': 'text/x-java',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.cs': 'text/x-csharp',
    '.html': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.sh': 'text/x-sh',
    '.bat': 'text/plain',
    '.ps1': 'text/plain',
    '.ini': 'text/plain',
    '.cfg': 'text/plain',
    '.log': 'text/plain',
    '.sql': 'text/x-sql',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    // 压缩文件类型
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed'
  };
  
  return mimeTypes[extension] || 'application/octet-stream';
}

// 更新剪贴板项目
app.post('/update/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const { title, content } = req.body;
  
  try {
    // 确保只使用title和content两个参数
    const stmt = db.prepare(`UPDATE clipboard SET title = ?, content = ? WHERE id = ?`);
    stmt.run(title, content, id);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 删除剪贴板项目
app.post('/delete/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  
  try {
    const row = db.prepare(`SELECT * FROM clipboard WHERE id = ?`).get(id);
    
    if (!row) {
      return res.status(404).json({ error: '项目未找到' });
    }
    
    // 如果是文件类型，删除文件
    if (row.type === 'file' && row.file_path) {
      try {
        // 从数据库中获取的file_path格式为'uploads/filename'，需要提取实际文件名
        const filename = path.basename(row.file_path);
        const fullPath = path.join(resolvePath(config.upload.uploadDir), filename);
        fs.unlinkSync(fullPath);
      } catch (err) {
        console.error('删除文件失败:', err);
      }
    }
    
    // 从数据库中删除记录
    db.prepare(`DELETE FROM clipboard WHERE id = ?`).run(id);
    res.redirect('/');
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 提供文件下载
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  // 使用配置中的上传目录
  const filePath = path.join(resolvePath(config.upload.uploadDir), filename);
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('文件未找到');
  }
  
  // 获取文件信息
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  
  // 设置文件名和类型
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  // 获取文件MIME类型（可选：使用mime-types等库获取更精确的MIME类型）
  res.setHeader('Content-Type', 'application/octet-stream');
  // 设置文件大小
  res.setHeader('Content-Length', fileSize);
  // 支持断点续传
  res.setHeader('Accept-Ranges', 'bytes');
  
  // 处理断点续传请求
  const range = req.headers.range;
  if (range) {
    // 解析Range头
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    
    // 验证范围
    if (start >= fileSize || end >= fileSize || start > end) {
      return res.status(416).send('请求范围不满足');
    }
    
    // 设置部分内容响应头
    const chunkSize = (end - start) + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    
    // 创建范围流
    const stream = fs.createReadStream(filePath, { start, end });
    return stream.pipe(res);
  } else {
    // 发送完整文件
    return fs.createReadStream(filePath).pipe(res);
  }
});

// 获取文本文件内容（用于预览）
app.get('/text-preview/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('SELECT * FROM clipboard WHERE id = ? AND type = \'file\'');
    const item = stmt.get(id);
    
    if (!item || !item.file_path) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    // 获取文件的完整路径，处理相对路径
    // 从数据库中获取的file_path格式为'uploads/filename'，需要提取实际文件名
    const filename = path.basename(item.file_path);
    const filePath = path.join(resolvePath(config.upload.uploadDir), filename);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    // 获取文件信息
    const stats = fs.statSync(filePath);
    const fileType = getFileType(filePath);
    
    // 检查文件类型和大小
    const isTextFile = [
      'text/plain', 'text/xml', 'application/json', 'text/javascript', 
      'text/x-python', 'text/x-java', 'text/x-c', 'text/x-c++', 'text/x-csharp',
      'text/html', 'text/css', 'text/markdown', 'text/x-sh', 'text/x-sql',
      'text/yaml'
    ].includes(fileType);
    
    // 文件大小限制为1MB
    const sizeLimit = 10 * 1024 * 1024; // 10MB
    
    if (!isTextFile) {
      return res.status(400).json({ error: '不是文本文件' });
    }
    
    if (stats.size > sizeLimit) {
      return res.status(400).json({ error: '文件太大，无法预览' });
    }
    
    // 读取文件内容
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error('读取文件失败:', err);
        return res.status(500).json({ error: '读取文件失败' });
      }
      
      res.json({ content: data, type: fileType });
    });
  } catch (err) {
    console.error('获取文本预览失败:', err.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Vditor上传处理
app.post('/upload/vditor', (req, res) => {
  vditorUpload.single('file')(req, res, function(err) {
    // 处理文件过滤器中的错误
    if (err) {
      return res.status(400).json({
        msg: err.message || '文件上传失败',
        code: 1,
        data: {}
      });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({
          msg: '未找到上传的文件',
          code: 1,
          data: {}
        });
      }
      
      // 返回URL
      const vditorFileUrl = `/vditor/${req.file.filename}`;
      
      // 返回符合Vditor要求的数据格式
      res.json({
        msg: '',
        code: 0,
        data: {
          errFiles: [],
          succMap: {
            [req.file.originalname]: vditorFileUrl
          }
        }
      });
    } catch (err) {
      return res.status(500).json({
        msg: err.message,
        code: 1,
        data: {}
      });
    }
  });
});

// 管理页面路由
app.get('/admin', authMiddleware, (req, res) => {
  res.render('admin', { config, formatDateTime: formatDateTime });
});

// 更新密码
app.post('/admin/update-password', authMiddleware, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: '密码不能为空' });
    }
    
    // 更新配置
    config.auth.password = password;
    
    // 保存到配置文件
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    
    res.json({ success: true });
  } catch (err) {
    console.error('更新密码失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新上传目录
app.post('/admin/update-upload-dirs', authMiddleware, (req, res) => {
  try {
    const { uploadDir: newUploadDir, vditoruploadsDir: newVditorDir } = req.body;
    
    if (!newUploadDir || !newVditorDir) {
      return res.status(400).json({ success: false, error: '上传目录不能为空' });
    }
    
    // 验证并创建目录
    try {
      const resolvedUploadDir = resolvePath(newUploadDir);
      const resolvedVditorDir = resolvePath(newVditorDir);
      
      if (!fs.existsSync(resolvedUploadDir)) {
        fs.mkdirSync(resolvedUploadDir, { recursive: true });
      }
      
      if (!fs.existsSync(resolvedVditorDir)) {
        fs.mkdirSync(resolvedVditorDir, { recursive: true });
      }
      
      // 更新配置
      config.upload.uploadDir = newUploadDir;
      config.upload.vditoruploadsDir = newVditorDir;
      
      // 保存到配置文件
      fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
      
      res.json({ success: true });
    } catch (err) {
      throw new Error(`目录创建失败: ${err.message}`);
    }
  } catch (err) {
    console.error('更新上传目录失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/sync-files', authMiddleware, async (req, res) => {
  try {
    const { 
      dbMissingFile, 
      fileMissingDb, 
      convertTxtToText, 
      txtMaxSize, 
      convertMdToMarkdown, 
      mdMaxSize 
    } = req.body;
    
    // 记录传入的参数，用于调试
    console.log('文件同步参数:', {
      dbMissingFile,
      fileMissingDb,
      convertTxtToText,
      txtMaxSize,
      convertMdToMarkdown,
      mdMaxSize,
      convertTxtToTextType: typeof convertTxtToText,
      convertMdToMarkdownType: typeof convertMdToMarkdown
    });
    
    // 更新配置
    config.fileSync.dbMissingFile = dbMissingFile;
    config.fileSync.fileMissingDb = fileMissingDb;
    config.fileSync.convertTxtToText = convertTxtToText === 'on' || convertTxtToText === true;
    config.fileSync.txtMaxSize = parseInt(txtMaxSize) || 1024;
    config.fileSync.convertMdToMarkdown = convertMdToMarkdown === 'on' || convertMdToMarkdown === true;
    config.fileSync.mdMaxSize = parseInt(mdMaxSize) || 1024;
    
    // 保存到配置文件
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    
    // 同步结果统计
    const result = {
      deletedRecords: 0,
      addedRecords: 0,
      deletedFiles: 0,
      convertedTxtFiles: 0,
      convertedMdFiles: 0
    };
    
    // 1. 处理数据库中存在但文件不存在的情况
    if (dbMissingFile === 'delete') {
      const fileItems = db.prepare(`SELECT * FROM clipboard WHERE type = 'file'`).all();
      
      for (const item of fileItems) {
        if (item.file_path) {
          const filename = path.basename(item.file_path);
          const filePath = path.join(resolvePath(config.upload.uploadDir), filename);
          if (!fs.existsSync(filePath)) {
            // 文件不存在，删除数据库记录
            db.prepare(`DELETE FROM clipboard WHERE id = ?`).run(item.id);
            result.deletedRecords++;
          }
        }
      }
    }
    
    // 2. 处理文件存在但数据库中不存在的情况
    if (fileMissingDb === 'add') {
      // 获取数据库中所有文件路径
      const dbFilePaths = db.prepare(`SELECT file_path FROM clipboard WHERE type = 'file'`)
        .all()
        .map(item => item.file_path)
        .filter(Boolean);
      
      // 获取上传目录中所有文件
      const resolvedUploadDir = resolvePath(config.upload.uploadDir);
      const files = fs.readdirSync(resolvedUploadDir);
      
      for (const file of files) {
        const relativePath = `uploads/${file}`;
        const fullPath = path.join(resolvedUploadDir, file);
        
        if (fs.statSync(fullPath).isFile() && !dbFilePaths.includes(relativePath)) {
          const stats = fs.statSync(fullPath);
          const fileExt = path.extname(file).toLowerCase();
          const fileSize = stats.size / 1024; // 转换为KB
          const fileName = path.basename(file, fileExt);
          
          // 检查是否为.txt文件且需要转换为文本剪贴板
          if (fileExt === '.txt' && config.fileSync.convertTxtToText && fileSize <= config.fileSync.txtMaxSize) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              db.prepare(`INSERT INTO clipboard (type, title, content, created_at) VALUES (?, ?, ?, ?)`)
                .run('text', fileName, content, formatDateTime(stats.birthtime));
              result.convertedTxtFiles++;
              // 将文件移动到 /deleted 目录
              const deletedFilePath = path.join(resolvedUploadDir, 'deleted', file);
              fs.mkdirSync(path.join(resolvedUploadDir, 'deleted'), { recursive: true });
              fs.renameSync(fullPath, deletedFilePath);
              result.deletedFiles++;
            } catch (err) {
              console.error(`转换文本文件失败 ${file}:`, err);
              console.error(`文件信息: 路径=${fullPath}, 大小=${fileSize}KB, 限制=${config.fileSync.txtMaxSize}KB`);
            }
          }
          // 检查是否为.md文件且需要转换为Markdown剪贴板
          else if (fileExt === '.md' && config.fileSync.convertMdToMarkdown && fileSize <= config.fileSync.mdMaxSize) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              db.prepare(`INSERT INTO clipboard (type, title, content, created_at) VALUES (?, ?, ?, ?)`)
                .run('markdown', fileName, content, formatDateTime(stats.birthtime));
              result.convertedMdFiles++;
              // 将文件移动到 /deleted 目录
              const deletedFilePath = path.join(resolvedUploadDir, 'deleted', file);
              fs.mkdirSync(path.join(resolvedUploadDir, 'deleted'), { recursive: true });
              fs.renameSync(fullPath, deletedFilePath);
              result.deletedFiles++;
            } catch (err) {
              console.error(`转换Markdown文件失败 ${file}:`, err);
              console.error(`文件信息: 路径=${fullPath}, 大小=${fileSize}KB, 限制=${config.fileSync.mdMaxSize}KB`);
            }
          }
          // 其他文件类型直接添加到数据库
          else {
            db.prepare(`INSERT INTO clipboard (type, title, file_path, created_at) VALUES (?, ?, ?, ?)`)
              .run('file', fileName, relativePath, formatDateTime(stats.birthtime));
            result.addedRecords++;
          }
        }
      }
    }
    // 处理文件存在但数据库中不存在的情况,并移动多余的文件到 /deleted 目录
    else if (fileMissingDb === 'delete') {
      // 获取数据库中所有文件路径
      const dbFilePaths = db.prepare(`SELECT file_path FROM clipboard WHERE type = 'file'`)
        .all()
        .map(item => item.file_path)
        .filter(Boolean);
      
      // 获取上传目录中所有文件
      const resolvedUploadDir = resolvePath(config.upload.uploadDir);
      const files = fs.readdirSync(resolvedUploadDir);
      
      for (const file of files) {
        const relativePath = `uploads/${file}`;
        const fullPath = path.join(resolvedUploadDir, file);
        
        if (fs.statSync(fullPath).isFile() && !dbFilePaths.includes(relativePath)) {
          // 文件存在但数据库中不存在,移动文件到 /deleted 目录
          const deletedFilePath = path.join(resolvedUploadDir, 'deleted', file);
          fs.mkdirSync(path.join(resolvedUploadDir, 'deleted'), { recursive: true });
          fs.renameSync(fullPath, deletedFilePath);
          result.deletedFiles++;
        }
      }
    }
    
    res.json({ 
      success: true, 
      deletedRecords: result.deletedRecords,
      addedRecords: result.addedRecords,
      deletedFiles: result.deletedFiles,
      convertedTxtFiles: result.convertedTxtFiles,
      convertedMdFiles: result.convertedMdFiles
    });
  } catch (err) {
    console.error('文件同步失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});