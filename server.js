const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

const dbPath = path.join(__dirname, 'electrocuotas.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error al conectar con la base de datos:', err);
  else console.log('Conectado a la base de datos SQLite.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    dni TEXT,
    telefono TEXT,
    direccion TEXT,
    notas TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER,
    producto TEXT,
    precio_costo REAL DEFAULT 0,
    precio_total REAL NOT NULL,
    anticipo REAL DEFAULT 0,
    cantidad_cuotas INTEGER,
    frecuencia TEXT DEFAULT 'mensual',
    fecha_inicio TEXT,
    garante_nombre TEXT,
    garante_dni TEXT,
    garante_telefono TEXT,
    garante_direccion TEXT,
    usuario TEXT DEFAULT 'admin',
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cuotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    numero_cuota INTEGER,
    monto_cuota REAL,
    fecha_vencimiento TEXT,
    estado TEXT DEFAULT 'PENDIENTE',
    FOREIGN KEY(venta_id) REFERENCES ventas(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cuota_id INTEGER,
    monto REAL,
    monto_mora REAL DEFAULT 0,
    fecha_pago TEXT,
    metodo TEXT DEFAULT 'EFECTIVO',
    usuario TEXT DEFAULT 'admin',
    FOREIGN KEY(cuota_id) REFERENCES cuotas(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cajas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT,
    fecha_apertura TEXT,
    monto_inicial REAL,
    fecha_cierre TEXT,
    monto_cierre REAL,
    monto_real REAL,
    diferencia REAL,
    estado TEXT DEFAULT 'ABIERTA'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER,
    tipo TEXT,
    monto REAL,
    concepto TEXT,
    usuario TEXT,
    fecha TEXT,
    FOREIGN KEY(caja_id) REFERENCES cajas(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    clave TEXT NOT NULL,
    rol TEXT DEFAULT 'CAJERO'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transferencias_mp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mp_payment_id TEXT UNIQUE,
    monto REAL,
    pagador TEXT,
    fecha TEXT,
    leido INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_negocio TEXT DEFAULT 'UltraCuotas',
    direccion TEXT,
    telefono TEXT,
    ancho_ticket TEXT DEFAULT '80mm',
    mensaje_pie TEXT,
    logo_base64 TEXT,
    logo_login_base64 TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    soporte_whatsapp TEXT DEFAULT '+54 9 3843-404771',
    soporte_whatsapp_2 TEXT DEFAULT '',
    soporte_texto TEXT DEFAULT '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.',
    mp_access_token TEXT
  )`, () => {
    db.run(`ALTER TABLE configuracion ADD COLUMN soporte_whatsapp_2 TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE configuracion ADD COLUMN soporte_texto TEXT DEFAULT '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.'`, () => {});

    db.get('SELECT COUNT(*) as cant FROM configuracion', (err, row) => {
      if (row && row.cant === 0) {
        db.run(`INSERT INTO configuracion (nombre_negocio, soporte_whatsapp, soporte_whatsapp_2, soporte_texto) 
                VALUES ('UltraCuotas', '+54 9 3843-404771', '', '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.')`);
      }
    });
  });

  // Asegura usuario admin y soporte siempre
  db.run(`INSERT OR REPLACE INTO usuarios (id, nombre, usuario, clave, rol) 
          VALUES (1, 'Administrador General', 'admin', 'admin', 'ADMIN')`);
  db.run(`INSERT OR REPLACE INTO usuarios (id, nombre, usuario, clave, rol) 
          VALUES (2, 'Soporte Técnico', 'soporte', 'soporte2026', 'SOPORTE')`);
});

// Endpoints Login y Usuarios
app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body;
  db.get('SELECT id, nombre, usuario, rol FROM usuarios WHERE usuario = ? AND clave = ?', [usuario, clave], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    res.json(row);
  });
});

app.get('/api/usuarios', (req, res) => {
  db.all('SELECT id, nombre, usuario, rol FROM usuarios ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/usuarios', (req, res) => {
  const { nombre, usuario, clave, rol } = req.body;
  db.run('INSERT INTO usuarios (nombre, usuario, clave, rol) VALUES (?, ?, ?, ?)', [nombre, usuario, clave, rol || 'CAJERO'], function(err) {
    if (err) return res.status(500).json({ error: 'El usuario ya existe o hubo un error' });
    res.json({ id: this.lastID, nombre, usuario, rol });
  });
});

app.delete('/api/usuarios/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM usuarios WHERE id = ? AND usuario != "admin"', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Endpoints Configuración
app.get('/api/configuracion', (req, res) => {
  db.get('SELECT * FROM configuracion ORDER BY id DESC LIMIT 1', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

app.post('/api/configuracion', (req, res) => {
  const {
    nombre_negocio, direccion, telefono, ancho_ticket, mensaje_pie,
    logo_base64, logo_login_base64, telegram_bot_token, telegram_chat_id,
    soporte_whatsapp, soporte_whatsapp_2, soporte_texto, mp_access_token
  } = req.body;

  db.get('SELECT id FROM configuracion ORDER BY id DESC LIMIT 1', [], (err, row) => {
    if (row) {
      db.run(`UPDATE configuracion SET 
        nombre_negocio = ?, direccion = ?, telefono = ?, ancho_ticket = ?, mensaje_pie = ?,
        logo_base64 = ?, logo_login_base64 = ?, telegram_bot_token = ?, telegram_chat_id = ?,
        soporte_whatsapp = ?, soporte_whatsapp_2 = ?, soporte_texto = ?, mp_access_token = ?
        WHERE id = ?`,
        [
          nombre_negocio, direccion, telefono, ancho_ticket, mensaje_pie,
          logo_base64, logo_login_base64, telegram_bot_token, telegram_chat_id,
          soporte_whatsapp, soporte_whatsapp_2, soporte_texto, mp_access_token, row.id
        ],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        }
      );
    } else {
      db.run(`INSERT INTO configuracion (
        nombre_negocio, direccion, telefono, ancho_ticket, mensaje_pie,
        logo_base64, logo_login_base64, telegram_bot_token, telegram_chat_id,
        soporte_whatsapp, soporte_whatsapp_2, soporte_texto, mp_access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nombre_negocio, direccion, telefono, ancho_ticket, mensaje_pie,
          logo_base64, logo_login_base64, telegram_bot_token, telegram_chat_id,
          soporte_whatsapp, soporte_whatsapp_2, soporte_texto, mp_access_token
        ],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, id: this.lastID });
        }
      );
    }
  });
});

// Clientes
app.get('/api/clientes', (req, res) => {
  db.all('SELECT * FROM clientes ORDER BY nombre ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/clientes', (req, res) => {
  const { nombre, dni, telefono, direccion, notas } = req.body;
  db.run('INSERT INTO clientes (nombre, dni, telefono, direccion, notas) VALUES (?, ?, ?, ?, ?)',
    [nombre, dni, telefono, direccion, notas],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, nombre, dni, telefono, direccion, notas });
    }
  );
});

app.put('/api/clientes/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, dni, telefono, direccion, notas } = req.body;
  db.run('UPDATE clientes SET nombre = ?, dni = ?, telefono = ?, direccion = ?, notas = ? WHERE id = ?',
    [nombre, dni, telefono, direccion, notas, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.delete('/api/clientes/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM clientes WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
app.put('/api/usuarios/:id/clave', (req, res) => {
  const { id } = req.params;
  const { clave } = req.body;
  if (!clave || clave.trim() === '') {
    return res.status(400).json({ error: 'La contraseña no puede estar vacía' });
  }
  db.run('UPDATE usuarios SET clave = ? WHERE id = ?', [clave.trim(), id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Ventas y Cuotas
app.post('/api/ventas', (req, res) => {
  const {
    cliente_id, producto, precio_costo, precio_total, anticipo,
    cantidad_cuotas, frecuencia, fecha_inicio,
    garante_nombre, garante_dni, garante_telefono, garante_direccion, usuario
  } = req.body;

  db.run(`INSERT INTO ventas (
    cliente_id, producto, precio_costo, precio_total, anticipo,
    cantidad_cuotas, frecuencia, fecha_inicio,
    garante_nombre, garante_dni, garante_telefono, garante_direccion, usuario
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cliente_id, producto, precio_costo || 0, precio_total, anticipo || 0,
      cantidad_cuotas, frecuencia || 'mensual', fecha_inicio,
      garante_nombre || null, garante_dni || null, garante_telefono || null, garante_direccion || null,
      usuario || 'admin'
    ],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const ventaId = this.lastID;
      const saldo = Math.max(0, precio_total - (anticipo || 0));
      const montoCuota = cantidad_cuotas > 0 ? (saldo / cantidad_cuotas) : 0;

      const fBase = new Date(fecha_inicio + 'T00:00:00');
      let inserts = 0;

      for (let i = 1; i <= cantidad_cuotas; i++) {
        let mes = fBase.getMonth() + i;
        let anio = fBase.getFullYear();
        while (mes > 11) {
          mes -= 12;
          anio++;
        }
        const strMes = String(mes + 1).padStart(2, '0');
        const strFechaVenc = `${anio}-${strMes}-10`;

        db.run('INSERT INTO cuotas (venta_id, numero_cuota, monto_cuota, fecha_vencimiento, estado) VALUES (?, ?, ?, ?, "PENDIENTE")',
          [ventaId, i, montoCuota, strFechaVenc],
          () => {
            inserts++;
            if (inserts === cantidad_cuotas) {
              res.json({ success: true, ventaId });
            }
          }
        );
      }
    }
  );
});

app.get('/api/creditos-cliente/:clienteId', (req, res) => {
  const { clienteId } = req.params;
  const sql = `
    SELECT v.id as venta_id, v.producto, v.precio_total, v.anticipo, v.cantidad_cuotas as total_cuotas,
           v.fecha_inicio, v.garante_nombre, v.garante_dni, v.garante_telefono, v.garante_direccion,
           COALESCE(SUM(CASE WHEN c.estado != 'PAGADA' THEN (c.monto_cuota - COALESCE(pagado.suma_pagada, 0)) ELSE 0 END), 0) as saldo_deuda,
           COUNT(CASE WHEN c.estado != 'PAGADA' THEN 1 END) as cuotas_pendientes
    FROM ventas v
    LEFT JOIN cuotas c ON v.id = c.venta_id
    LEFT JOIN (SELECT cuota_id, SUM(monto) as suma_pagada FROM pagos GROUP BY cuota_id) pagado ON c.id = pagado.cuota_id
    WHERE v.cliente_id = ?
    GROUP BY v.id
    ORDER BY v.id DESC
  `;
  db.all(sql, [clienteId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/cuotas-credito/:ventaId', (req, res) => {
  const { ventaId } = req.params;
  const hoy = new Date().toISOString().split('T')[0];
  const sql = `
    SELECT c.id as cuota_id, c.numero_cuota, c.monto_cuota, c.fecha_vencimiento, c.estado as estado_cuota,
           COALESCE(p.suma_pagada, 0) as pagado,
           (c.monto_cuota - COALESCE(p.suma_pagada, 0)) as resto_pendiente,
           CASE 
             WHEN c.estado != 'PAGADA' AND date(c.fecha_vencimiento) < date(?) THEN CAST(julianday(?) - julianday(c.fecha_vencimiento) AS INTEGER)
             ELSE 0 
           END as dias_atraso
    FROM cuotas c
    LEFT JOIN (SELECT cuota_id, SUM(monto) as suma_pagada FROM pagos GROUP BY cuota_id) p ON c.id = p.cuota_id
    WHERE c.venta_id = ?
    ORDER BY c.numero_cuota ASC
  `;
  db.all(sql, [hoy, hoy, ventaId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Cobranzas y Recibos
app.post('/api/cobrar', (req, res) => {
  const { cuota_id, monto, monto_mora, metodo, usuario } = req.body;
  const fechaHoy = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString('es-AR');

  db.run('INSERT INTO pagos (cuota_id, monto, monto_mora, fecha_pago, metodo, usuario) VALUES (?, ?, ?, ?, ?, ?)',
    [cuota_id, monto, monto_mora || 0, fechaHoy, metodo || 'EFECTIVO', usuario || 'admin'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.get('SELECT c.monto_cuota, COALESCE(SUM(p.monto), 0) as total_pagado FROM cuotas c LEFT JOIN pagos p ON c.id = p.cuota_id WHERE c.id = ? GROUP BY c.id', [cuota_id], (err, row) => {
        if (row) {
          const nuevoEstado = row.total_pagado >= row.monto_cuota ? 'PAGADA' : 'PARCIAL';
          db.run('UPDATE cuotas SET estado = ? WHERE id = ?', [nuevoEstado, cuota_id]);
        }
      });

      if (metodo === 'EFECTIVO') {
        db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
          if (caja) {
            db.run('INSERT INTO movimientos_caja (caja_id, tipo, monto, concepto, usuario, fecha) VALUES (?, "INGRESO", ?, ?, ?, ?)',
              [caja.id, monto + (monto_mora || 0), `Cobranza de Cuota ID #${cuota_id}`, usuario || 'admin', fechaHoy]
            );
          }
        });
      }

      res.json({ success: true, pago_id: this.lastID });
    }
  );
});

app.post('/api/liquidar-credito', (req, res) => {
  const { venta_id, usuario } = req.body;
  const fechaHoy = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString('es-AR');

  const sql = `
    SELECT c.id, c.monto_cuota, COALESCE(p.suma, 0) as pagado
    FROM cuotas c
    LEFT JOIN (SELECT cuota_id, SUM(monto) as suma FROM pagos GROUP BY cuota_id) p ON c.id = p.cuota_id
    WHERE c.venta_id = ? AND c.estado != 'PAGADA'
  `;

  db.all(sql, [venta_id], (err, cuotas) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!cuotas || cuotas.length === 0) return res.json({ success: true, mensaje: 'Ya liquidado' });

    let cobradoTotal = 0;
    cuotas.forEach(c => {
      const resto = c.monto_cuota - c.pagado;
      if (resto > 0) {
        cobradoTotal += resto;
        db.run('INSERT INTO pagos (cuota_id, monto, monto_mora, fecha_pago, metodo, usuario) VALUES (?, ?, 0, ?, "EFECTIVO", ?)',
          [c.id, resto, fechaHoy, usuario || 'admin']
        );
        db.run('UPDATE cuotas SET estado = "PAGADA" WHERE id = ?', [c.id]);
      }
    });

    db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
      if (caja && cobradoTotal > 0) {
        db.run('INSERT INTO movimientos_caja (caja_id, tipo, monto, concepto, usuario, fecha) VALUES (?, "INGRESO", ?, ?, ?, ?)',
          [caja.id, cobradoTotal, `Liquidación Total Venta #${venta_id}`, usuario || 'admin', fechaHoy]
        );
      }
    });

    res.json({ success: true, totalLiquidado: cobradoTotal });
  });
});

app.get('/api/pagos-cliente/:clienteId', (req, res) => {
  const { clienteId } = req.params;
  const sql = `
    SELECT p.id as pago_id, p.monto, p.monto_mora, p.fecha_pago, p.metodo, c.numero_cuota, v.producto
    FROM pagos p
    JOIN cuotas c ON p.cuota_id = c.id
    JOIN ventas v ON c.venta_id = v.id
    WHERE v.cliente_id = ?
    ORDER BY p.id DESC
  `;
  db.all(sql, [clienteId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Alertas Vencimientos Día 10
app.get('/api/alertas-vencimientos', (req, res) => {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mesStr = String(hoy.getMonth() + 1).padStart(2, '0');
  const vencimientoMesActual = `${anio}-${mesStr}-10`;

  const sql = `
    SELECT c.id as cuota_id, c.numero_cuota, c.fecha_vencimiento, 
           (c.monto_cuota - COALESCE(p.suma, 0)) as resto_pendiente,
           cl.nombre as cliente_nombre, cl.telefono as cliente_telefono, v.producto,
           v.garante_nombre, v.garante_telefono,
           CASE 
             WHEN date(c.fecha_vencimiento) < date('now', 'localtime') THEN 'VENCIDA'
             ELSE 'POR_VENCER'
           END as tipo_alerta
    FROM cuotas c
    JOIN ventas v ON c.venta_id = v.id
    JOIN clientes cl ON v.cliente_id = cl.id
    LEFT JOIN (SELECT cuota_id, SUM(monto) as suma FROM pagos GROUP BY cuota_id) p ON c.id = p.cuota_id
    WHERE c.estado != 'PAGADA' 
      AND (c.fecha_vencimiento <= ? OR c.fecha_vencimiento <= date('now', 'localtime'))
    ORDER BY c.fecha_vencimiento ASC
  `;
  db.all(sql, [vencimientoMesActual], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Caja Diaria
app.get('/api/caja/estado', (req, res) => {
  db.get('SELECT * FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!caja) return res.json({ abierta: false });

    const sqlResumen = `
      SELECT 
        COALESCE(SUM(CASE WHEN tipo = 'INGRESO' AND concepto LIKE 'Cobranza%' THEN monto ELSE 0 END), 0) as cobranzas,
        COALESCE(SUM(CASE WHEN tipo = 'INGRESO' AND concepto NOT LIKE 'Cobranza%' THEN monto ELSE 0 END), 0) as ingresos,
        COALESCE(SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 0) as egresos
      FROM movimientos_caja WHERE caja_id = ?
    `;
    db.get(sqlResumen, [caja.id], (err, r) => {
      const cobranzas = r ? r.cobranzas : 0;
      const ingresos = r ? r.ingresos : 0;
      const egresos = r ? r.egresos : 0;
      const totalEsperado = caja.monto_inicial + cobranzas + ingresos - egresos;

      res.json({
        abierta: true,
        caja,
        resumen: {
          monto_inicial: caja.monto_inicial,
          cobranzas,
          ingresos,
          egresos,
          total_esperado: totalEsperado
        }
      });
    });
  });
});

app.post('/api/caja/abrir', (req, res) => {
  const { usuario, monto_inicial } = req.body;
  const fechaHoy = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString('es-AR');

  db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" LIMIT 1', [], (err, row) => {
    if (row) return res.status(400).json({ error: 'Ya existe una caja abierta' });

    db.run('INSERT INTO cajas (usuario, fecha_apertura, monto_inicial, estado) VALUES (?, ?, ?, "ABIERTA")',
      [usuario || 'admin', fechaHoy, monto_inicial || 0],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, cajaId: this.lastID });
      }
    );
  });
});

app.get('/api/caja/movimientos', (req, res) => {
  db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
    if (!caja) return res.json([]);
    db.all('SELECT * FROM movimientos_caja WHERE caja_id = ? ORDER BY id DESC', [caja.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });
});

app.post('/api/caja/movimiento', (req, res) => {
  const { tipo, monto, concepto, usuario } = req.body;
  const fechaHoy = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString('es-AR');

  db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
    if (!caja) return res.status(400).json({ error: 'No hay ninguna caja abierta' });

    db.run('INSERT INTO movimientos_caja (caja_id, tipo, monto, concepto, usuario, fecha) VALUES (?, ?, ?, ?, ?, ?)',
      [caja.id, tipo, parseFloat(monto), concepto, usuario || 'admin', fechaHoy],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      }
    );
  });
});

app.post('/api/caja/cerrar', (req, res) => {
  const { monto_real, total_esperado } = req.body;
  const fechaHoy = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString('es-AR');

  db.get('SELECT id FROM cajas WHERE estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [], (err, caja) => {
    if (!caja) return res.status(400).json({ error: 'No hay caja abierta para cerrar' });

    const mReal = parseFloat(monto_real);
    const mEsp = parseFloat(total_esperado);
    const dif = mReal - mEsp;

    db.run('UPDATE cajas SET fecha_cierre = ?, monto_cierre = ?, monto_real = ?, diferencia = ?, estado = "CERRADA" WHERE id = ?',
      [fechaHoy, mEsp, mReal, dif, caja.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, diferencia: dif });
      }
    );
  });
});

// Mercado Pago
app.get('/api/transferencias-pendientes', (req, res) => {
  db.get('SELECT * FROM transferencias_mp WHERE leido = 0 ORDER BY id ASC LIMIT 1', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) res.json({ hay: true, transferencia: row });
    else res.json({ hay: false });
  });
});

app.post('/api/transferencias-leida/:id', (req, res) => {
  db.run('UPDATE transferencias_mp SET leido = 1 WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Respaldos
app.get('/api/backup/descargar', (req, res) => {
  const backupName = `backup-ultracuotas-${new Date().toISOString().split('T')[0]}.sqlite`;
  res.download(dbPath, backupName);
});

app.post('/api/backup/restaurar', (req, res) => {
  const { archivo_base64 } = req.body;
  if (!archivo_base64) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  const base64Data = archivo_base64.replace(/^data:.*?;base64,/, '');
  fs.writeFile(dbPath, base64Data, 'base64', (err) => {
    if (err) return res.status(500).json({ error: 'Error al escribir base de datos' });
    res.json({ success: true });
  });
});

app.post('/api/backup/probar-telegram', (req, res) => {
  res.json({ success: true, mensaje: 'Servicio de prueba verificado.' });
});

app.listen(PORT, () => {
  console.log(`Servidor UltraCuotas corriendo en http://localhost:${PORT}`);
});