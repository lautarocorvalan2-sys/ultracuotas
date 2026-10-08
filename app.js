const API_BASE = 'http://localhost:3000';

let ipcRenderer = null;
let shell = null;
try {
  const electron = require('electron');
  ipcRenderer = electron.ipcRenderer;
  shell = electron.shell;
} catch (e) {}

let usuarioSesion = null;
let cajaActivaActual = null;
let configNegocioActual = null;
let listaClientes = [];
let clienteSeleccionadoActual = null;
let datosUltimoCobroPreparado = null;
let transferenciaActualMostrada = null;
let intervaloRevisionMP = null;

const inputFechaVenta = document.getElementById('venta-fecha');
if (inputFechaVenta) {
  inputFechaVenta.value = new Date().toISOString().split('T')[0];
}

function lanzarAnyDesk() {
  window.location.href = 'anydesk:';
  setTimeout(() => {
    if (confirm('Si AnyDesk no se abrió automáticamente, ¿deseás abrir la página para descargarlo?')) {
      window.open('https://anydesk.com/es/downloads/windows', '_blank');
    }
  }, 1500);
}

// ==================== ENVÍO AUTOMÁTICO DE WHATSAPP ====================
function enviarComprobanteWhatsappAutomatico(datos) {
  if (!datos.cliente || !datos.cliente.telefono) return;

  let tel = datos.cliente.telefono.toString().replace(/[^0-9]/g, '');
  if (!tel) return;

  // Formato estándar para números de Argentina
  if (tel.startsWith('0')) tel = tel.substring(1);
  if (tel.startsWith('15')) tel = tel.substring(2);

  if (!tel.startsWith('549') && !tel.startsWith('54')) {
    tel = '549' + tel;
  } else if (tel.startsWith('54') && !tel.startsWith('549')) {
    tel = '549' + tel.slice(2);
  }

  const negocio = (configNegocioActual && configNegocioActual.nombre_negocio) ? configNegocioActual.nombre_negocio : 'ULTRACUOTAS';
  const fechaHora = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  const mensaje = 
`🧾 *COMPROBANTE DE PAGO - ${negocio}*
━━━━━━━━━━━━━━━━━━━━
*Abonado:* ${datos.cliente.nombre}
*DNI:* ${datos.cliente.dni || 'S/D'}
*Concepto:* ${datos.concepto}
*Detalle:* ${datos.cuotaInfo}
*Fecha/Hora:* ${fechaHora}

💵 *Total Pagado:* $${datos.totalCobrado.toFixed(2)}
*Medio de Pago:* ${datos.metodo}
*Comprobante N°:* ${datos.nroRecibo}
━━━━━━━━━━━━━━━━━━━━
📊 *ESTADO DE CUENTA:*
*Saldo restante:* $${datos.saldoRestante.toFixed(2)}
*Cuotas pendientes:* ${datos.cuotasRestantes}
━━━━━━━━━━━━━━━━━━━━
_Conserve este mensaje como comprobante de pago oficial._`;

  const urlWsp = `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(mensaje)}`;

  if (shell && typeof shell.openExternal === 'function') {
    shell.openExternal(urlWsp);
  } else {
    window.open(urlWsp, '_blank');
  }
}

async function cargarSoporteLoginPrevio() {
  try {
    const res = await fetch(`${API_BASE}/api/configuracion`);
    if (!res.ok) return;
    const cfg = await res.json();

    const lblTexto = document.getElementById('lbl-login-soporte-texto');
    const lblWsp1 = document.getElementById('lbl-login-soporte-wsp');
    const boxWsp2 = document.getElementById('box-login-wsp2');
    const lblWsp2 = document.getElementById('lbl-login-soporte-wsp2');

    if (cfg) {
      if (lblTexto && cfg.soporte_texto) lblTexto.textContent = cfg.soporte_texto;
      if (lblWsp1 && cfg.soporte_whatsapp) lblWsp1.textContent = cfg.soporte_whatsapp;
      if (cfg.soporte_whatsapp_2 && cfg.soporte_whatsapp_2.trim() !== '') {
        if (boxWsp2) boxWsp2.style.display = 'block';
        if (lblWsp2) lblWsp2.textContent = cfg.soporte_whatsapp_2;
      } else {
        if (boxWsp2) boxWsp2.style.display = 'none';
      }
    }
  } catch (err) {}
}

async function ejecutarLogin(e) {
  if (e) e.preventDefault();
  const inputUsr = document.getElementById('login-usuario');
  const inputPass = document.getElementById('login-clave');
  const errBox = document.getElementById('login-error-msg');

  if (!inputUsr || !inputPass) return;

  const usuario = inputUsr.value.trim();
  const clave = inputPass.value.trim();

  if (errBox) errBox.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave })
    });

    if (res.ok) {
      usuarioSesion = await res.json();
      sessionStorage.setItem('usuario_pos', JSON.stringify(usuarioSesion));
      
      if (ipcRenderer) {
        ipcRenderer.send('login-exitoso');
      }

      iniciarApp();
    } else {
      const err = await res.json();
      if (errBox) {
        errBox.textContent = err.error || 'Usuario o contraseña incorrectos';
        errBox.style.display = 'block';
      }

      inputPass.value = '';
      setTimeout(() => {
        inputPass.focus();
        inputPass.select();
      }, 50);
    }
  } catch (error) {
    if (errBox) {
      errBox.textContent = 'Error al conectar con http://localhost:3000';
      errBox.style.display = 'block';
    }
  }
}

// ==================== SALIDA INTELIGENTE DE SESIÓN ====================
async function ejecutarSalidaConTurnoAbierto() {
  const esSoporte = usuarioSesion && (usuarioSesion.rol === 'SOPORTE' || usuarioSesion.usuario === 'soporte');

  if (esSoporte) {
    forzarCierreSesion();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/caja/estado`);
    const data = await res.json();

    if (data.abierta) {
      const modalSalida = document.getElementById('modal-salida-segura');
      if (modalSalida) modalSalida.classList.add('open');
    } else {
      forzarCierreSesion();
    }
  } catch (e) {
    forzarCierreSesion();
  }
}

function cerrarModalSalidaSegura() {
  const m = document.getElementById('modal-salida-segura');
  if (m) m.classList.remove('open');
}

function confirmarSalidaSinCerrarCaja() {
  cerrarModalSalidaSegura();
  forzarCierreSesion();
}

function irACerrarCajaDesdeSalida() {
  cerrarModalSalidaSegura();
  abrirModalCierreCaja();
}

function forzarCierreSesion() {
  sessionStorage.removeItem('usuario_pos');
  usuarioSesion = null;

  if (intervaloRevisionMP) clearInterval(intervaloRevisionMP);
  if (ipcRenderer) ipcRenderer.send('logout-exitoso');

  window.location.reload();
}

function verificarSesionPrevia() {
  const guardado = sessionStorage.getItem('usuario_pos');
  if (guardado) {
    usuarioSesion = JSON.parse(guardado);
    if (ipcRenderer) ipcRenderer.send('login-exitoso');
    iniciarApp();
  } else {
    cargarSoporteLoginPrevio();
    setTimeout(() => {
      const u = document.getElementById('login-usuario');
      if (u) {
        u.focus();
        u.select();
      }
    }, 150);
  }
}

function iniciarApp() {
  const pantLogin = document.getElementById('pantalla-login');
  const appPrincipal = document.getElementById('sistema-app');
  if (pantLogin) pantLogin.style.display = 'none';
  if (appPrincipal) appPrincipal.style.display = 'block';
  
  const lblUsr = document.getElementById('lbl-usuario-actual');
  if (lblUsr && usuarioSesion) {
    lblUsr.textContent = `${usuarioSesion.usuario} (${usuarioSesion.rol})`;
  }

  const esSoporte = usuarioSesion && (usuarioSesion.rol === 'SOPORTE' || usuarioSesion.usuario === 'soporte');
  const btnMPSoporte = document.getElementById('tab-btn-mp-soporte');
  const boxTelegram = document.getElementById('box-telegram-soporte');
  const btnSoporteContacto = document.querySelector("button[onclick*='soporte']");

  if (esSoporte) {
    if (btnMPSoporte) btnMPSoporte.style.display = 'inline-block';
    if (boxTelegram) boxTelegram.style.display = 'block';
    if (btnSoporteContacto) btnSoporteContacto.style.display = 'inline-block';
  } else {
    if (btnMPSoporte) btnMPSoporte.style.display = 'none';
    if (boxTelegram) boxTelegram.style.display = 'none';
    if (btnSoporteContacto) btnSoporteContacto.style.display = 'none';
  }

  iniciarCobranzas();
  cargarEstadoCaja();
  cargarConfiguracion();

  if (intervaloRevisionMP) clearInterval(intervaloRevisionMP);
  intervaloRevisionMP = setInterval(verificarTransferenciasEntrantes, 3000);
}

function cambiarSubConfig(subpanel, btn) {
  document.querySelectorAll('.cfg-tab-btn').forEach(b => b.classList.remove('activo'));
  document.querySelectorAll('.cfg-subpanel').forEach(p => p.classList.remove('activo'));

  if (btn) btn.classList.add('activo');
  const target = document.getElementById('cfg-sub-' + subpanel);
  if (target) target.classList.add('activo');

  if (subpanel === 'usuarios') cargarListaUsuarios();
}

async function cargarConfiguracion() {
  try {
    const res = await fetch(`${API_BASE}/api/configuracion`);
    configNegocioActual = await res.json();

    if (configNegocioActual) {
      if (document.getElementById('cfg-nombre')) document.getElementById('cfg-nombre').value = configNegocioActual.nombre_negocio || 'UltraCuotas';
      if (document.getElementById('cfg-direccion')) document.getElementById('cfg-direccion').value = configNegocioActual.direccion || '';
      if (document.getElementById('cfg-telefono')) document.getElementById('cfg-telefono').value = configNegocioActual.telefono || '';
      if (document.getElementById('cfg-ancho')) document.getElementById('cfg-ancho').value = configNegocioActual.ancho_ticket || '80mm';
      if (document.getElementById('cfg-pie')) document.getElementById('cfg-pie').value = configNegocioActual.mensaje_pie || '¡Muchas gracias por su compra!';
      if (document.getElementById('cfg-tg-token')) document.getElementById('cfg-tg-token').value = configNegocioActual.telegram_bot_token || '';
      if (document.getElementById('cfg-tg-chatid')) document.getElementById('cfg-tg-chatid').value = configNegocioActual.telegram_chat_id || '';
      if (document.getElementById('cfg-tg-token-view')) document.getElementById('cfg-tg-token-view').value = configNegocioActual.telegram_bot_token || '';
      if (document.getElementById('cfg-tg-chatid-view')) document.getElementById('cfg-tg-chatid-view').value = configNegocioActual.telegram_chat_id || '';
      if (document.getElementById('cfg-mp-token')) document.getElementById('cfg-mp-token').value = configNegocioActual.mp_access_token || '';

      if (document.getElementById('cfg-soporte-texto')) {
        document.getElementById('cfg-soporte-texto').value = configNegocioActual.soporte_texto || '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.';
      }
      if (document.getElementById('cfg-soporte-wsp1')) {
        document.getElementById('cfg-soporte-wsp1').value = configNegocioActual.soporte_whatsapp || '+54 9 3843-404771';
      }
      if (document.getElementById('cfg-soporte-wsp2')) {
        document.getElementById('cfg-soporte-wsp2').value = configNegocioActual.soporte_whatsapp_2 || '';
      }

      const headerLogoImg = document.getElementById('header-logo-preview');
      const headerLogoPlaceholder = document.getElementById('header-logo-placeholder');
      const cfgLogoImg = document.getElementById('img-logo-cfg-view');
      const cfgLogoTxt = document.getElementById('txt-sin-logo-cfg');

      if (configNegocioActual.logo_base64) {
        if (headerLogoImg) {
          headerLogoImg.src = configNegocioActual.logo_base64;
          headerLogoImg.style.display = 'block';
        }
        if (headerLogoPlaceholder) headerLogoPlaceholder.style.display = 'none';

        if (cfgLogoImg) {
          cfgLogoImg.src = configNegocioActual.logo_base64;
          cfgLogoImg.style.display = 'block';
        }
        if (cfgLogoTxt) cfgLogoTxt.style.display = 'none';
        if (document.getElementById('cfg-logo-base64')) document.getElementById('cfg-logo-base64').value = configNegocioActual.logo_base64;
      } else {
        if (headerLogoImg) headerLogoImg.style.display = 'none';
        if (headerLogoPlaceholder) headerLogoPlaceholder.style.display = 'block';
        if (cfgLogoImg) cfgLogoImg.style.display = 'none';
        if (cfgLogoTxt) cfgLogoTxt.style.display = 'inline';
        if (document.getElementById('cfg-logo-base64')) document.getElementById('cfg-logo-base64').value = '';
      }
    }
  } catch (err) {}
  cargarListaUsuarios();
}

async function guardarConfiguracionSoporte(e) {
  e.preventDefault();
  const texto = document.getElementById('cfg-soporte-texto').value.trim();
  const wsp1 = document.getElementById('cfg-soporte-wsp1').value.trim();
  const wsp2 = document.getElementById('cfg-soporte-wsp2').value.trim();

  const cfg = configNegocioActual || {};
  const datos = {
    nombre_negocio: document.getElementById('cfg-nombre').value || cfg.nombre_negocio || 'UltraCuotas',
    direccion: document.getElementById('cfg-direccion').value || cfg.direccion || '',
    telefono: document.getElementById('cfg-telefono').value || cfg.telefono || '',
    ancho_ticket: document.getElementById('cfg-ancho').value || cfg.ancho_ticket || '80mm',
    mensaje_pie: document.getElementById('cfg-pie').value || cfg.mensaje_pie || '',
    telegram_bot_token: document.getElementById('cfg-tg-token').value || cfg.telegram_bot_token || '',
    telegram_chat_id: document.getElementById('cfg-tg-chatid').value || cfg.telegram_chat_id || '',
    mp_access_token: document.getElementById('cfg-mp-token').value || cfg.mp_access_token || '',
    logo_base64: document.getElementById('cfg-logo-base64').value || cfg.logo_base64 || '',
    logo_login_base64: '',
    soporte_texto: texto,
    soporte_whatsapp: wsp1,
    soporte_whatsapp_2: wsp2
  };

  const res = await fetch(`${API_BASE}/api/configuracion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert('✅ Contactos y textos de soporte guardados.');
    cargarConfiguracion();
  } else {
    alert('Error al guardar datos de soporte');
  }
}

async function guardarConfiguracionTickets(e) {
  e.preventDefault();
  const cfg = configNegocioActual || {};
  const datos = {
    nombre_negocio: document.getElementById('cfg-nombre').value,
    direccion: document.getElementById('cfg-direccion').value,
    telefono: document.getElementById('cfg-telefono').value,
    ancho_ticket: document.getElementById('cfg-ancho').value,
    mensaje_pie: document.getElementById('cfg-pie').value,
    telegram_bot_token: document.getElementById('cfg-tg-token').value || cfg.telegram_bot_token || '',
    telegram_chat_id: document.getElementById('cfg-tg-chatid').value || cfg.telegram_chat_id || '',
    soporte_whatsapp: cfg.soporte_whatsapp || '+54 9 3843-404771',
    soporte_whatsapp_2: cfg.soporte_whatsapp_2 || '',
    soporte_texto: cfg.soporte_texto || '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.',
    mp_access_token: document.getElementById('cfg-mp-token').value || cfg.mp_access_token || '',
    logo_base64: document.getElementById('cfg-logo-base64').value || cfg.logo_base64 || '',
    logo_login_base64: ''
  };

  const res = await fetch(`${API_BASE}/api/configuracion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert('Configuración guardada.');
    cargarConfiguracion();
  } else {
    alert('Error al guardar configuración');
  }
}

function procesarArchivoLogoSubpanel(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const base64 = e.target.result;
      document.getElementById('cfg-logo-base64').value = base64;
      await guardarLogoGeneral(base64, 'Logo del Comercio actualizado');
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function guardarLogoGeneral(logoComercio, mensajeExito) {
  const cfg = configNegocioActual || {};
  const datos = {
    nombre_negocio: document.getElementById('cfg-nombre').value || cfg.nombre_negocio || 'UltraCuotas',
    direccion: document.getElementById('cfg-direccion').value || cfg.direccion || '',
    telefono: document.getElementById('cfg-telefono').value || cfg.telefono || '',
    ancho_ticket: document.getElementById('cfg-ancho').value || cfg.ancho_ticket || '80mm',
    mensaje_pie: document.getElementById('cfg-pie').value || cfg.mensaje_pie || '',
    telegram_bot_token: document.getElementById('cfg-tg-token').value || cfg.telegram_bot_token || '',
    telegram_chat_id: document.getElementById('cfg-tg-chatid').value || cfg.telegram_chat_id || '',
    soporte_whatsapp: cfg.soporte_whatsapp || '+54 9 3843-404771',
    soporte_whatsapp_2: cfg.soporte_whatsapp_2 || '',
    soporte_texto: cfg.soporte_texto || '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.',
    mp_access_token: document.getElementById('cfg-mp-token').value || cfg.mp_access_token || '',
    logo_base64: logoComercio,
    logo_login_base64: ''
  };

  const res = await fetch(`${API_BASE}/api/configuracion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert(mensajeExito);
    cargarConfiguracion();
  } else {
    alert('Error al guardar el logo');
  }
}

async function quitarLogoComercio() {
  if (!confirm('¿Desea quitar el logo del comercio?')) return;
  await guardarLogoGeneral('', 'Logo eliminado');
}

function reproducirSonidoCampana() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}

function mostrarCartelTransferenciaDirecto(t) {
  transferenciaActualMostrada = t;
  document.getElementById('lbl-mp-monto-transferido').textContent = `$${parseFloat(t.monto).toFixed(2)}`;
  document.getElementById('lbl-mp-pagador').textContent = t.pagador || 'Desconocido';
  document.getElementById('lbl-mp-op-id').textContent = t.mp_payment_id || '-';

  const modal = document.getElementById('modal-transferencia-recibida');
  if (modal) modal.classList.add('open');

  reproducirSonidoCampana();
}

async function verificarTransferenciasEntrantes() {
  try {
    const res = await fetch(`${API_BASE}/api/transferencias-pendientes`);
    const data = await res.json();
    if (data.hay && data.transferencia) {
      mostrarCartelTransferenciaDirecto(data.transferencia);
    }
  } catch (err) {}
}

async function cerrarAvisoTransferencia() {
  if (transferenciaActualMostrada && transferenciaActualMostrada.id) {
    try {
      await fetch(`${API_BASE}/api/transferencias-leida/${transferenciaActualMostrada.id}`, { method: 'POST' });
    } catch (e) {}
    transferenciaActualMostrada = null;
  }
  const modal = document.getElementById('modal-transferencia-recibida');
  if (modal) modal.classList.remove('open');
}

async function aplicarTransferenciaAlCobro() {
  if (transferenciaActualMostrada) {
    const modalCobro = document.getElementById('modal-cobrar');
    const modalCobroAbierto = modalCobro && modalCobro.classList.contains('open');
    const inputMonto = document.getElementById('cobro-monto-input');
    const selectMetodo = document.getElementById('cobro-metodo-select');

    if (modalCobroAbierto && inputMonto) {
      inputMonto.value = transferenciaActualMostrada.monto.toFixed(2);
      if (selectMetodo) selectMetodo.value = 'TRANSFERENCIA';
      actualizarTotalCobroModal();
    } else {
      alert(`Monto de $${transferenciaActualMostrada.monto.toFixed(2)} registrado.`);
    }
  }
  cerrarAvisoTransferencia();
}

function probarSimulacionTransferencia() {
  const fakeData = {
    id: 999999,
    mp_payment_id: 'TR-TEST-' + Math.floor(100000 + Math.random() * 900000),
    monto: 15500.00,
    pagador: 'MARIO ALBERTO GÓMEZ'
  };
  mostrarCartelTransferenciaDirecto(fakeData);
}

async function guardarConfiguracionMP(e) {
  e.preventDefault();
  const token = document.getElementById('cfg-mp-token').value.trim();
  const cfg = configNegocioActual || {};

  const datos = {
    nombre_negocio: document.getElementById('cfg-nombre').value || cfg.nombre_negocio || 'UltraCuotas',
    direccion: document.getElementById('cfg-direccion').value || cfg.direccion || '',
    telefono: document.getElementById('cfg-telefono').value || cfg.telefono || '',
    ancho_ticket: document.getElementById('cfg-ancho').value || cfg.ancho_ticket || '80mm',
    mensaje_pie: document.getElementById('cfg-pie').value || cfg.mensaje_pie || '',
    logo_base64: document.getElementById('cfg-logo-base64').value || cfg.logo_base64 || '',
    logo_login_base64: '',
    telegram_bot_token: document.getElementById('cfg-tg-token').value || cfg.telegram_bot_token || '',
    telegram_chat_id: document.getElementById('cfg-tg-chatid').value || cfg.telegram_chat_id || '',
    soporte_whatsapp: cfg.soporte_whatsapp || '+54 9 3843-404771',
    soporte_whatsapp_2: cfg.soporte_whatsapp_2 || '',
    soporte_texto: cfg.soporte_texto || '¿Querés contratar este sistema? Instalación, soporte técnico y desarrollo a medida.',
    mp_access_token: token
  };

  const res = await fetch(`${API_BASE}/api/configuracion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert('Credencial guardada');
    cargarConfiguracion();
  } else {
    alert('Error al guardar credenciales');
  }
}

function descargarBackup() {
  window.location.href = `${API_BASE}/api/backup/descargar`;
}

function ejecutarRestauracion(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  if (!confirm(`¿Restaurar la base de datos desde "${file.name}"? Los datos actuales serán reemplazados.`)) {
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const res = await fetch(`${API_BASE}/api/backup/restaurar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo_base64: e.target.result })
      });
      const data = await res.json();
      if (res.ok) {
        alert('¡Copia restaurada! Recargando...');
        window.location.reload();
      } else {
        alert(data.error || 'Error al restaurar.');
      }
    } catch (err) {
      alert('Error de conexión.');
    }
    input.value = '';
  };
  reader.readAsDataURL(file);
}

async function cargarEstadoCaja() {
  const res = await fetch(`${API_BASE}/api/caja/estado`);
  const data = await res.json();

  const viewCerrada = document.getElementById('caja-cerrada-view');
  const viewAbierta = document.getElementById('caja-abierta-view');
  const esSoporte = usuarioSesion && (usuarioSesion.rol === 'SOPORTE' || usuarioSesion.usuario === 'soporte');

  if (!data.abierta) {
    cajaActivaActual = null;
    if (esSoporte) {
      if (viewCerrada) viewCerrada.style.display = 'none';
      if (viewAbierta) viewAbierta.style.display = 'block';
      document.getElementById('stat-caja-inicial').textContent = '$0.00';
      document.getElementById('stat-caja-cobranzas').textContent = '$0.00';
      document.getElementById('stat-caja-ingresos').textContent = '$0.00';
      document.getElementById('stat-caja-egresos').textContent = '$0.00';
      document.getElementById('stat-caja-esperado').textContent = '(Modo Soporte)';
    } else {
      if (viewCerrada) viewCerrada.style.display = 'block';
      if (viewAbierta) viewAbierta.style.display = 'none';
    }
  } else {
    cajaActivaActual = data;
    if (viewCerrada) viewCerrada.style.display = 'none';
    if (viewAbierta) viewAbierta.style.display = 'block';

    const r = data.resumen;
    document.getElementById('stat-caja-inicial').textContent = `$${r.monto_inicial.toFixed(2)}`;
    document.getElementById('stat-caja-cobranzas').textContent = `$${r.cobranzas.toFixed(2)}`;
    document.getElementById('stat-caja-ingresos').textContent = `$${r.ingresos.toFixed(2)}`;
    document.getElementById('stat-caja-egresos').textContent = `$${r.egresos.toFixed(2)}`;
    document.getElementById('stat-caja-esperado').textContent = `$${r.total_esperado.toFixed(2)}`;

    cargarMovimientosCaja();
  }
}

async function abrirCaja(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('monto-apertura');
  const monto = input ? (parseFloat(input.value) || 0) : 0;

  try {
    const res = await fetch(`${API_BASE}/api/caja/abrir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: usuarioSesion ? usuarioSesion.usuario : 'admin', monto_inicial: monto })
    });

    if (res.ok) {
      if (input) input.value = '';
      await cargarEstadoCaja();
      window.focus();
    } else {
      const err = await res.json();
      alert(err.error || 'Error al abrir caja');
    }
  } catch (error) {
    alert('Error de conexión');
  }
}

async function cargarMovimientosCaja() {
  const res = await fetch(`${API_BASE}/api/caja/movimientos`);
  const movs = await res.json();
  const tbody = document.getElementById('tabla-movimientos-caja-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (movs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No hay movimientos registrados en esta sesión.</td></tr>';
    return;
  }

  movs.forEach(m => {
    const tr = document.createElement('tr');
    const esEgreso = m.tipo === 'EGRESO';
    tr.innerHTML = `
      <td>${m.fecha.split(' ')[1] || m.fecha}</td>
      <td><span class="status-badge ${esEgreso ? 'status-pendiente' : 'status-pagada'}">${m.tipo}</span></td>
      <td>${m.concepto}</td>
      <td>${m.usuario}</td>
      <td><strong style="color: ${esEgreso ? 'var(--danger)' : 'var(--success)'};">${esEgreso ? '-' : '+'}$${m.monto.toFixed(2)}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirModalMovimiento(tipo) {
  document.getElementById('mov-tipo').value = tipo;
  document.getElementById('modal-mov-titulo').textContent = tipo === 'INGRESO' ? '➕ Entrada de Efectivo' : '➖ Retiro / Gasto';
  document.getElementById('mov-monto').value = '';
  document.getElementById('mov-concepto').value = '';
  document.getElementById('modal-movimiento').classList.add('open');
}

function cerrarModalMovimiento() {
  const m = document.getElementById('modal-movimiento');
  if (m) m.classList.remove('open');
}

async function guardarMovimientoCaja(e) {
  e.preventDefault();
  const tipo = document.getElementById('mov-tipo').value;
  const monto = document.getElementById('mov-monto').value;
  const concepto = document.getElementById('mov-concepto').value;

  const res = await fetch(`${API_BASE}/api/caja/movimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, monto, concepto, usuario: usuarioSesion ? usuarioSesion.usuario : 'admin' })
  });

  if (res.ok) {
    cerrarModalMovimiento();
    cargarEstadoCaja();
  } else {
    const err = await res.json();
    alert(err.error || 'Error al guardar');
  }
}

function abrirModalCierreCaja() {
  if (!cajaActivaActual) {
    alert('No hay una caja abierta registrada para cerrar.');
    return;
  }

  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));

  const esperado = cajaActivaActual.resumen ? cajaActivaActual.resumen.total_esperado : 0;
  const lblEsp = document.getElementById('lbl-cierre-esperado');
  if (lblEsp) lblEsp.textContent = `$${esperado.toFixed(2)}`;

  const inputReal = document.getElementById('cierre-monto-real');
  if (inputReal) {
    inputReal.value = '';
    inputReal.disabled = false;
    inputReal.readOnly = false;
  }

  const boxDif = document.getElementById('box-cierre-diferencia');
  if (boxDif) boxDif.style.display = 'none';

  const modalCierre = document.getElementById('modal-cierre');
  if (modalCierre) modalCierre.classList.add('open');

  setTimeout(() => {
    if (inputReal) {
      inputReal.focus();
      inputReal.select();
    }
  }, 100);
}

function cerrarModalCierre() {
  const m = document.getElementById('modal-cierre');
  if (m) m.classList.remove('open');
}

function recalcularDiferenciaArqueoModal() {
  const real = parseFloat(document.getElementById('cierre-monto-real').value);
  const esperado = (cajaActivaActual && cajaActivaActual.resumen) ? cajaActivaActual.resumen.total_esperado : 0;
  const boxDif = document.getElementById('box-cierre-diferencia');
  const lblDif = document.getElementById('lbl-cierre-diferencia');

  if (!isNaN(real)) {
    boxDif.style.display = 'flex';
    const dif = real - esperado;
    if (Math.abs(dif) < 0.01) {
      lblDif.textContent = 'Exacto ($0.00)';
      lblDif.style.color = 'var(--success)';
    } else if (dif > 0) {
      lblDif.textContent = `Sobrante: +$${dif.toFixed(2)}`;
      lblDif.style.color = 'var(--warning)';
    } else {
      lblDif.textContent = `Faltante: -$${Math.abs(dif).toFixed(2)}`;
      lblDif.style.color = 'var(--danger)';
    }
  } else {
    boxDif.style.display = 'none';
  }
}

async function ejecutarCierreCaja(e) {
  if (e) e.preventDefault();
  const inputReal = document.getElementById('cierre-monto-real');
  const real = inputReal ? parseFloat(inputReal.value) : NaN;
  const esperado = (cajaActivaActual && cajaActivaActual.resumen) ? cajaActivaActual.resumen.total_esperado : 0;

  if (isNaN(real) || real < 0) {
    alert('Por favor ingrese un monto real válido en caja.');
    if (inputReal) inputReal.focus();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/caja/cerrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto_real: real,
        total_esperado: esperado,
        usuario: usuarioSesion ? usuarioSesion.usuario : 'admin'
      })
    });

    if (res.ok) {
      cerrarModalCierre();
      forzarCierreSesion();
    } else {
      const err = await res.json();
      alert(err.error || 'Error al cerrar caja');
    }
  } catch (error) {
    alert('Error al cerrar caja');
  }
}

function seleccionarTipoOperacion(tipo) {
  document.getElementById('tipo-operacion-actual').value = tipo;
  const btnArt = document.getElementById('btn-tipo-articulo');
  const btnPres = document.getElementById('btn-tipo-prestamo');
  const bloqueArt = document.getElementById('bloque-calculo-articulo');
  const bloquePres = document.getElementById('bloque-calculo-prestamo');
  const lblConcepto = document.getElementById('lbl-concepto-nombre');
  const inputConcepto = document.getElementById('venta-producto');
  const btnComparativa = document.getElementById('btn-ver-comparativa');
  const btnSubmit = document.getElementById('btn-submit-operacion');

  if (tipo === 'ARTICULO') {
    btnArt.classList.add('activo');
    btnPres.classList.remove('activo');
    bloqueArt.style.display = 'grid';
    bloquePres.style.display = 'none';
    btnComparativa.style.display = 'inline-flex';
    lblConcepto.textContent = 'Artículo / Concepto';
    inputConcepto.placeholder = 'Ej: Smart TV 43" Noblex';
    document.getElementById('lbl-res-base').textContent = 'Base Contado';
    document.getElementById('lbl-res-recargo').textContent = 'Recargo Financiación';
    btnSubmit.textContent = 'Emitir Plan de Crédito Comercial';
    actualizarPlanCuotas();
  } else {
    btnPres.classList.add('activo');
    btnArt.classList.remove('activo');
    bloqueArt.style.display = 'none';
    bloquePres.style.display = 'grid';
    btnComparativa.style.display = 'none';
    document.getElementById('wrap-tabla-comparativa').style.display = 'none';
    lblConcepto.textContent = 'Motivo del Préstamo';
    inputConcepto.value = 'PRÉSTAMO PERSONAL EN EFECTIVO';
    document.getElementById('lbl-res-base').textContent = 'Capital a Prestar';
    document.getElementById('lbl-res-recargo').textContent = 'Interés Acordado';
    btnSubmit.textContent = 'Otorgar Préstamo y Retirar Efectivo';
    recalcularPrestamo();
  }
}

function recalcularPrestamo() {
  const capital = parseFloat(document.getElementById('prestamo-capital').value) || 0;
  const tasa = parseFloat(document.getElementById('prestamo-tasa').value) || 0;
  const cuotas = parseInt(document.getElementById('prestamo-cuotas').value, 10) || 1;

  const interesMonto = capital * (tasa / 100);
  const totalDevolver = capital + interesMonto;
  const valorCuota = cuotas > 0 ? (totalDevolver / cuotas) : 0;

  document.getElementById('prestamo-total').value = totalDevolver.toFixed(2);
  document.getElementById('res-base').textContent = `$${capital.toFixed(2)}`;
  document.getElementById('res-recargo').textContent = `${tasa.toFixed(1)}% (+$${interesMonto.toFixed(2)})`;
  document.getElementById('res-total').textContent = `$${totalDevolver.toFixed(2)}`;
  document.getElementById('res-cuota').textContent = `${cuotas} de $${valorCuota.toFixed(2)}`;
}

function recalcularPrestamoDesdeTotal() {
  const capital = parseFloat(document.getElementById('prestamo-capital').value) || 0;
  const total = parseFloat(document.getElementById('prestamo-total').value) || 0;
  const cuotas = parseInt(document.getElementById('prestamo-cuotas').value, 10) || 1;

  if (capital > 0) {
    const tasa = ((total - capital) / capital) * 100;
    document.getElementById('prestamo-tasa').value = tasa.toFixed(1);
    const valorCuota = cuotas > 0 ? (total / cuotas) : 0;
    document.getElementById('res-base').textContent = `$${capital.toFixed(2)}`;
    document.getElementById('res-recargo').textContent = `${tasa.toFixed(1)}%`;
    document.getElementById('res-total').textContent = `$${total.toFixed(2)}`;
    document.getElementById('res-cuota').textContent = `${cuotas} de $${valorCuota.toFixed(2)}`;
  }
}

function alternarCamposGarante() {
  const chk = document.getElementById('check-requiere-garante');
  const box = document.getElementById('box-campos-garante');
  if (chk.checked) {
    box.classList.add('open');
  } else {
    box.classList.remove('open');
    document.getElementById('garante-nombre').value = '';
    document.getElementById('garante-dni').value = '';
    document.getElementById('garante-telefono').value = '';
    document.getElementById('garante-direccion').value = '';
  }
}

function recalcularDesdeCosto() {
  const costo = parseFloat(document.getElementById('calc-costo').value) || 0;
  const margen = parseFloat(document.getElementById('calc-margen').value) || 0;
  const contado = costo + (costo * (margen / 100));
  document.getElementById('calc-precio-contado').value = contado.toFixed(2);
  actualizarPlanCuotas();
}

function recalcularDesdeContado() {
  const costo = parseFloat(document.getElementById('calc-costo').value) || 0;
  const contado = parseFloat(document.getElementById('calc-precio-contado').value) || 0;
  if (costo > 0) {
    const margen = ((contado - costo) / costo) * 100;
    document.getElementById('calc-margen').value = margen.toFixed(1);
  }
  actualizarPlanCuotas();
}

function actualizarPlanCuotas() {
  const contado = parseFloat(document.getElementById('calc-precio-contado').value) || 0;
  const anticipo = parseFloat(document.getElementById('calc-anticipo').value) || 0;
  const cuotas = parseInt(document.getElementById('calc-cuotas').value, 10) || 1;
  const tasa = parseFloat(document.getElementById('calc-recargo-tasa').value) || 0;

  let recargo = (cuotas > 3) ? (cuotas - 3) * tasa : 0;
  const total = contado + (contado * (recargo / 100));
  const saldo = Math.max(0, total - anticipo);
  const valorCuota = cuotas > 0 ? (saldo / cuotas) : 0;

  document.getElementById('res-base').textContent = `$${contado.toFixed(2)}`;
  document.getElementById('res-recargo').textContent = `${recargo.toFixed(1)}%`;
  document.getElementById('res-total').textContent = `$${total.toFixed(2)}`;
  document.getElementById('res-cuota').textContent = `${cuotas} de $${valorCuota.toFixed(2)}`;

  cargarTablaComparativa();
}

function alternarTablaCuotas() {
  const wrap = document.getElementById('wrap-tabla-comparativa');
  wrap.style.display = wrap.style.display === 'block' ? 'none' : 'block';
  cargarTablaComparativa();
}

function cargarTablaComparativa() {
  const contado = parseFloat(document.getElementById('calc-precio-contado').value) || 0;
  const anticipo = parseFloat(document.getElementById('calc-anticipo').value) || 0;
  const tasa = parseFloat(document.getElementById('calc-recargo-tasa').value) || 0;
  const seleccionada = parseInt(document.getElementById('calc-cuotas').value, 10) || 1;

  const planes = [1, 2, 3, 4, 6, 9, 12];
  const tbody = document.getElementById('body-comparativo');
  if (!tbody) return;
  tbody.innerHTML = '';

  planes.forEach(num => {
    let rec = num > 3 ? (num - 3) * tasa : 0;
    const tot = contado + (contado * (rec / 100));
    const saldo = Math.max(0, tot - anticipo);
    const vCuota = saldo / num;

    const tr = document.createElement('tr');
    if (num === seleccionada) tr.style.background = 'var(--primary-light)';

    tr.innerHTML = `
      <td><strong>${num} ${num === 1 ? 'pago' : 'cuotas'}</strong></td>
      <td>${rec > 0 ? '+' + rec.toFixed(1) + '%' : 'Sin interés'}</td>
      <td>$${tot.toFixed(2)}</td>
      <td><strong style="color:var(--success); font-size:14px;">${num} de $${vCuota.toFixed(2)}</strong></td>
      <td>
        <button type="button" class="btn-badge btn-success" onclick="elegirCuota(${num})">
          ${num === seleccionada ? '✓ Elegido' : 'Elegir'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function elegirCuota(num) {
  document.getElementById('calc-cuotas').value = num;
  actualizarPlanCuotas();
}

async function guardarVenta(e) {
  e.preventDefault();
  const tipoOp = document.getElementById('tipo-operacion-actual').value;
  const requiereGarante = document.getElementById('check-requiere-garante').checked;

  let conceptoFinal = '';
  let costoFinal = 0;
  let totalFinal = 0;
  let anticipoFinal = 0;
  let cuotasFinal = 1;

  if (tipoOp === 'ARTICULO') {
    const contado = parseFloat(document.getElementById('calc-precio-contado').value) || 0;
    cuotasFinal = parseInt(document.getElementById('calc-cuotas').value, 10) || 1;
    const tasa = parseFloat(document.getElementById('calc-recargo-tasa').value) || 0;
    let recargo = (cuotasFinal > 3) ? (cuotasFinal - 3) * tasa : 0;

    conceptoFinal = document.getElementById('venta-producto').value.trim();
    costoFinal = parseFloat(document.getElementById('calc-costo').value) || 0;
    totalFinal = contado + (contado * (recargo / 100));
    anticipoFinal = parseFloat(document.getElementById('calc-anticipo').value) || 0;
  } else {
    const capital = parseFloat(document.getElementById('prestamo-capital').value) || 0;
    if (!capital || capital <= 0) {
      alert('Por favor ingrese el monto de capital a prestar.');
      return;
    }
    conceptoFinal = (document.getElementById('venta-producto').value.trim()) || 'PRÉSTAMO PERSONAL EN EFECTIVO';
    costoFinal = capital;
    totalFinal = parseFloat(document.getElementById('prestamo-total').value) || capital;
    anticipoFinal = 0;
    cuotasFinal = parseInt(document.getElementById('prestamo-cuotas').value, 10) || 1;

    try {
      await fetch(`${API_BASE}/api/caja/movimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'EGRESO',
          monto: capital,
          concepto: `Entrega Préstamo Personal: ${conceptoFinal}`,
          usuario: usuarioSesion ? usuarioSesion.usuario : 'admin'
        })
      });
    } catch (err) {}
  }

  const datos = {
    cliente_id: document.getElementById('venta-cliente').value,
    producto: conceptoFinal,
    precio_costo: costoFinal,
    precio_total: totalFinal.toFixed(2),
    anticipo: anticipoFinal,
    cantidad_cuotas: cuotasFinal,
    frecuencia: 'mensual',
    fecha_inicio: document.getElementById('venta-fecha').value,
    garante_nombre: requiereGarante ? document.getElementById('garante-nombre').value : null,
    garante_dni: requiereGarante ? document.getElementById('garante-dni').value : null,
    garante_telefono: requiereGarante ? document.getElementById('garante-telefono').value : null,
    garante_direccion: requiereGarante ? document.getElementById('garante-direccion').value : null,
    usuario: usuarioSesion ? usuarioSesion.usuario : 'admin'
  };

  const res = await fetch(`${API_BASE}/api/ventas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert(tipoOp === 'PRESTAMO' ? '¡Préstamo registrado exitosamente!' : 'Plan emitido con éxito con vencimiento el día 10.');
    document.getElementById('form-venta').reset();
    document.getElementById('venta-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('check-requiere-garante').checked = false;
    alternarCamposGarante();
    seleccionarTipoOperacion('ARTICULO');
    actualizarAlertas();
    cargarEstadoCaja();
  } else {
    alert('Error al registrar la operación');
  }
}

async function iniciarCobranzas() {
  const res = await fetch(`${API_BASE}/api/clientes`);
  listaClientes = await res.json();
  renderizarListaClientesCobranzas(listaClientes);
  actualizarAlertas();
}

function renderizarListaClientesCobranzas(clientes) {
  const cont = document.getElementById('lista-clientes-cobranzas');
  if (!cont) return;
  cont.innerHTML = '';

  if (clientes.length === 0) {
    cont.innerHTML = '<div style="padding:15px; color:var(--text-muted); font-size:13px; text-align:center;">No se encontraron abonados</div>';
    return;
  }

  clientes.forEach(cli => {
    const item = document.createElement('div');
    item.className = `cliente-item-btn ${clienteSeleccionadoActual && clienteSeleccionadoActual.id === cli.id ? 'activo' : ''}`;
    item.onclick = () => seleccionarClienteCobranza(cli, item);
    item.innerHTML = `
      <strong>${cli.nombre}</strong>
      <span>DNI: ${cli.dni || 'Sin DNI'} | Tel: ${cli.telefono || '-'}</span>
    `;
    cont.appendChild(item);
  });
}

function filtrarClientesEnLista() {
  const query = document.getElementById('buscar-cliente').value.toLowerCase().trim();
  const filtrados = listaClientes.filter(c => {
    const nom = (c.nombre || '').toLowerCase();
    const dni = (c.dni || '').toLowerCase();
    return nom.includes(query) || dni.includes(query);
  });
  renderizarListaClientesCobranzas(filtrados);
}

async function seleccionarClienteCobranza(cliente, elem) {
  clienteSeleccionadoActual = cliente;
  document.querySelectorAll('.cliente-item-btn').forEach(btn => btn.classList.remove('activo'));
  if (elem) elem.classList.add('activo');

  document.getElementById('detalle-cliente-vacio').style.display = 'none';
  document.getElementById('detalle-cliente-ficha').style.display = 'block';

  document.getElementById('ficha-nombre').textContent = cliente.nombre;
  document.getElementById('ficha-info').textContent = `DNI: ${cliente.dni || 'S/D'} • Tel: ${cliente.telefono || '-'} • Dir: ${cliente.direccion || '-'}`;

  await cargarCreditosCliente(cliente.id);
  await cargarHistorialPagos(cliente.id);
}

async function cargarCreditosCliente(clienteId) {
  const res = await fetch(`${API_BASE}/api/creditos-cliente/${clienteId}`);
  const creditos = await res.json();
  const contenedor = document.getElementById('contenedor-creditos-cliente');
  if (!contenedor) return;
  contenedor.innerHTML = '';

  if (creditos.length === 0) {
    contenedor.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">El abonado no posee créditos registrados.</div>';
    return;
  }

  creditos.forEach(cred => {
    const estaAlDia = cred.saldo_deuda <= 0;
    const card = document.createElement('div');
    card.className = `credito-card ${estaAlDia ? '' : 'activo'}`;
    card.id = `card-credito-${cred.venta_id}`;

    let bloqueGaranteHtml = '';
    if (cred.garante_nombre) {
      const wspGarante = cred.garante_telefono ? cred.garante_telefono.replace(/[^0-9]/g, '') : '';
      bloqueGaranteHtml = `
        <div class="garante-badge-box">
          <div>
            <strong>🛡️ Garante:</strong> ${cred.garante_nombre} 
            ${cred.garante_dni ? `(DNI: ${cred.garante_dni})` : ''} 
            ${cred.garante_telefono ? `• Tel: ${cred.garante_telefono}` : ''}
          </div>
          ${wspGarante ? `
            <button class="btn-wsp" style="padding: 3px 6px; font-size:10px;" onclick="event.stopPropagation(); window.open('https://wa.me/${wspGarante}', '_blank')">
              WSP Garante
            </button>
          ` : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="credito-card-header" onclick="alternarDespliegueCredito(${cred.venta_id})">
        <div style="flex:1;">
          <div class="credito-titulo">
            ${cred.producto}
            <span class="status-badge ${estaAlDia ? 'status-pagada' : 'status-pendiente'}" style="margin-left: 8px;">
              ${estaAlDia ? 'LIQUIDADO' : 'ACTIVO'}
            </span>
          </div>
          <div class="credito-detalles">
            Inicio: ${cred.fecha_inicio} • Total pactado: $${cred.precio_total.toFixed(2)} • Cuotas restantes: ${cred.cuotas_pendientes} de ${cred.total_cuotas}
          </div>
          ${bloqueGaranteHtml}
        </div>
        <div style="text-align: right; display: flex; align-items: center; gap: 12px; margin-left:15px;">
          <div>
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block;">SALDO RESTANTE</span>
            <strong style="font-size: 18px; color: ${estaAlDia ? 'var(--success)' : 'var(--danger)'};">
              $${cred.saldo_deuda.toFixed(2)}
            </strong>
          </div>
          ${!estaAlDia ? `
            <button type="button" class="btn-badge btn-danger" onclick="liquidarDeudaCredito(event, ${cred.venta_id}, ${cred.saldo_deuda}, '${cred.producto.replace(/'/g, "\\'")}')">
              Cancelar Deuda Total
            </button>
          ` : ''}
          <span id="flecha-${cred.venta_id}" style="font-size: 14px; color: var(--text-muted);">▼</span>
        </div>
      </div>
      <div class="credito-card-body" id="body-credito-${cred.venta_id}">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Cuota N°</th>
                <th>Vencimiento (1 al 10)</th>
                <th>Monto Cuota</th>
                <th>Resta Pagar</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody id="tbody-cuotas-credito-${cred.venta_id}">
              <tr><td colspan="6" style="text-align:center;">Cargando cuotas...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    contenedor.appendChild(card);
  });
}

async function alternarDespliegueCredito(ventaId) {
  const body = document.getElementById(`body-credito-${ventaId}`);
  const flecha = document.getElementById(`flecha-${ventaId}`);
  const estaAbierto = body.classList.contains('open');

  if (estaAbierto) {
    body.classList.remove('open');
    flecha.textContent = '▼';
  } else {
    body.classList.add('open');
    flecha.textContent = '▲';
    await cargarCuotasDeCredito(ventaId);
  }
}

async function cargarCuotasDeCredito(ventaId) {
  const res = await fetch(`${API_BASE}/api/cuotas-credito/${ventaId}`);
  const cuotas = await res.json();
  const tbody = document.getElementById(`tbody-cuotas-credito-${ventaId}`);
  if (!tbody) return;
  tbody.innerHTML = '';

  cuotas.forEach(c => {
    const tr = document.createElement('tr');
    const tieneMora = c.dias_atraso > 0 && c.estado_cuota !== 'PAGADA';
    tr.innerHTML = `
      <td><strong>Cuota ${c.numero_cuota}</strong></td>
      <td>
        ${c.fecha_vencimiento} 
        ${tieneMora ? `<span style="color:var(--danger); font-size:11px; font-weight:bold;">(+${c.dias_atraso}d mora)</span>` : ''}
      </td>
      <td>$${c.monto_cuota.toFixed(2)}</td>
      <td><strong style="color: ${c.resto_pendiente > 0 ? 'var(--danger)' : 'var(--success)'};">$${c.resto_pendiente.toFixed(2)}</strong></td>
      <td><span class="status-badge status-${c.estado_cuota.toLowerCase()}">${c.estado_cuota}</span></td>
      <td>
        ${c.estado_cuota !== 'PAGADA' 
          ? `<button type="button" class="btn-badge btn-success" onclick="abrirModalCobrar(${c.cuota_id}, ${c.resto_pendiente},${ventaId}, '${c.fecha_vencimiento}',${c.dias_atraso})">Cobrar</button>`
          : `<span style="color:var(--success); font-weight:700;">✓ Al día</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirModalCobrar(cuotaId, resto, ventaId, fechaVenc, diasAtraso, conceptoProd) {
  document.getElementById('cobro-cuota-id').value = cuotaId;
  document.getElementById('cobro-credito-id').value = ventaId;
  document.getElementById('cobro-monto-input').value = resto.toFixed(2);
  document.getElementById('cobro-monto-input').max = resto.toFixed(2);
  document.getElementById('cobro-modal-info').innerHTML = `Cuota pura: <strong>$${resto.toFixed(2)}</strong> • Vence: <strong>${fechaVenc}</strong>`;

  datosUltimoCobroPreparado = {
    cliente: clienteSeleccionadoActual,
    producto: conceptoProd || 'Artículo',
    cuotaId: cuotaId,
    fechaVenc: fechaVenc
  };

  const boxMora = document.getElementById('box-aviso-mora');
  const inputMora = document.getElementById('cobro-mora-input');
  const txtDias = document.getElementById('txt-dias-mora');

  if (diasAtraso > 0) {
    boxMora.style.display = 'flex';
    txtDias.textContent = `Registra ${diasAtraso} día(s) de atraso posterior al día 10.`;
    const moraCalculada = Math.round((resto * (diasAtraso * 0.01)) * 100) / 100;
    inputMora.value = moraCalculada.toFixed(2);
  } else {
    boxMora.style.display = 'none';
    inputMora.value = '0.00';
  }

  actualizarTotalCobroModal();
  document.getElementById('modal-cobrar').classList.add('open');
}

function actualizarTotalCobroModal() {
  const cuota = parseFloat(document.getElementById('cobro-monto-input').value) || 0;
  const mora = parseFloat(document.getElementById('cobro-mora-input').value) || 0;
  const total = cuota + mora;
  document.getElementById('lbl-total-cobro-final').textContent = `$${total.toFixed(2)}`;
}

function cerrarModalCobrar() {
  const m = document.getElementById('modal-cobrar');
  if (m) m.classList.remove('open');
}

async function confirmarCobroCuotaModal(e) {
  e.preventDefault();
  const cuotaId = document.getElementById('cobro-cuota-id').value;
  const ventaId = document.getElementById('cobro-credito-id').value;
  const monto = parseFloat(document.getElementById('cobro-monto-input').value);
  const mora = parseFloat(document.getElementById('cobro-mora-input').value) || 0;
  const metodo = document.getElementById('cobro-metodo-select').value;

  if (!monto || monto <= 0) {
    alert('Monto inválido');
    return;
  }

  const res = await fetch(`${API_BASE}/api/cobrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cuota_id: cuotaId,
      monto: monto,
      monto_mora: mora,
      metodo: metodo,
      usuario: usuarioSesion ? usuarioSesion.usuario : 'admin'
    })
  });

  if (res.ok) {
    cerrarModalCobrar();

    const resCred = await fetch(`${API_BASE}/api/creditos-cliente/${clienteSeleccionadoActual.id}`);
    const creditos = await resCred.json();
    const credActual = creditos.find(c => c.venta_id == ventaId) || {};

    const nroReciboGenerado = `REC-${cuotaId.toString().padStart(6, '0')}`;
    const conceptoFinalOperacion = credActual.producto || (datosUltimoCobroPreparado ? datosUltimoCobroPreparado.producto : 'Artículo');

    // 1. Imprime ticket físico
    imprimirTicketCorporativo({
      tipo: 'COMPROBANTE DE PAGO',
      nroRecibo: nroReciboGenerado,
      cliente: clienteSeleccionadoActual,
      garante: {
        nombre: credActual.garante_nombre,
        dni: credActual.garante_dni
      },
      concepto: conceptoFinalOperacion,
      cuotaInfo: `Cuota correspondiente`,
      fechaVencimiento: datosUltimoCobroPreparado ? datosUltimoCobroPreparado.fechaVenc : '',
      montoPuro: monto,
      montoMora: mora,
      totalCobrado: monto + mora,
      totalCredito: credActual.precio_total || 0,
      saldoRestante: credActual.saldo_deuda || 0,
      cuotasRestantes: credActual.cuotas_pendientes || 0,
      metodo: metodo
    });

    // 2. Dispara el comprobante de WhatsApp automáticamente
    enviarComprobanteWhatsappAutomatico({
      nroRecibo: nroReciboGenerado,
      cliente: clienteSeleccionadoActual,
      concepto: conceptoFinalOperacion,
      cuotaInfo: `Cuota correspondiente`,
      totalCobrado: monto + mora,
      saldoRestante: credActual.saldo_deuda || 0,
      cuotasRestantes: credActual.cuotas_pendientes || 0,
      metodo: metodo
    });

    await cargarCreditosCliente(clienteSeleccionadoActual.id);
    const body = document.getElementById(`body-credito-${ventaId}`);
    if (body) {
      body.classList.add('open');
      document.getElementById(`flecha-${ventaId}`).textContent = '▲';
      await cargarCuotasDeCredito(ventaId);
    }
    await cargarHistorialPagos(clienteSeleccionadoActual.id);
    actualizarAlertas();
    cargarEstadoCaja();
  } else {
    const err = await res.json();
    alert(err.error || 'Error al procesar cobro');
  }
}

async function liquidarDeudaCredito(e, ventaId, totalSaldo, nombreConcepto) {
  e.stopPropagation();
  if (!confirm(`¿Liquidar la deuda total de "${nombreConcepto}" por $${totalSaldo.toFixed(2)}?`)) return;

  const res = await fetch(`${API_BASE}/api/liquidar-credito`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venta_id: ventaId, usuario: usuarioSesion ? usuarioSesion.usuario : 'admin' })
  });

  if (res.ok) {
    alert('¡Operación liquidada exitosamente!');
    const nroReciboLiq = `LIQ-${ventaId.toString().padStart(6, '0')}`;

    imprimirTicketCorporativo({
      tipo: 'LIQUIDACIÓN TOTAL DE CRÉDITO',
      nroRecibo: nroReciboLiq,
      cliente: clienteSeleccionadoActual,
      concepto: nombreConcepto,
      cuotaInfo: 'CANCELACIÓN DEFINITIVA',
      montoPuro: totalSaldo,
      montoMora: 0,
      totalCobrado: totalSaldo,
      totalCredito: totalSaldo,
      saldoRestante: 0.00,
      cuotasRestantes: 0,
      metodo: 'EFECTIVO'
    });

    // Envío de WhatsApp para la liquidación total
    enviarComprobanteWhatsappAutomatico({
      nroRecibo: nroReciboLiq,
      cliente: clienteSeleccionadoActual,
      concepto: nombreConcepto,
      cuotaInfo: 'CANCELACIÓN TOTAL DEUDA',
      totalCobrado: totalSaldo,
      saldoRestante: 0.00,
      cuotasRestantes: 0,
      metodo: 'EFECTIVO'
    });

    if (clienteSeleccionadoActual) {
      await cargarCreditosCliente(clienteSeleccionadoActual.id);
      await cargarHistorialPagos(clienteSeleccionadoActual.id);
      actualizarAlertas();
      cargarEstadoCaja();
    }
  } else {
    const err = await res.json();
    alert(err.error || 'Error al liquidar');
  }
}

async function cargarHistorialPagos(clienteId) {
  const res = await fetch(`${API_BASE}/api/pagos-cliente/${clienteId}`);
  const pagos = await res.json();
  const tbody = document.getElementById('tabla-pagos-cliente-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (pagos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No hay comprobantes emitidos.</td></tr>';
    return;
  }

  pagos.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.fecha_pago}</td>
      <td>${p.producto}</td>
      <td>Cuota ${p.numero_cuota}</td>
      <td><strong style="color:var(--success);">$${p.monto.toFixed(2)}</strong></td>
      <td><span style="color:${p.monto_mora > 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-weight:bold;">+$${(p.monto_mora || 0).toFixed(2)}</span></td>
      <td>${p.metodo}</td>
      <td>
        <button class="btn-badge btn-warning" onclick='reimprimirTicketHistorial(${JSON.stringify(p).replace(/'/g, "&apos;")})'>🖨️ Ticket</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function reimprimirTicketHistorial(p) {
  imprimirTicketCorporativo({
    tipo: 'REIMPRESIÓN DE COMPROBANTE',
    nroRecibo: `REC-${p.pago_id.toString().padStart(6, '0')}`,
    cliente: clienteSeleccionadoActual,
    concepto: p.producto,
    cuotaInfo: `Cuota ${p.numero_cuota}`,
    montoPuro: p.monto,
    montoMora: p.monto_mora || 0,
    totalCobrado: p.monto + (p.monto_mora || 0),
    saldoRestante: 0.00,
    cuotasRestantes: 0,
    metodo: p.metodo
  });
}

function cambiarSubTab(tab) {
  const btnCreditos = document.getElementById('btn-subtab-creditos');
  const btnPagos = document.getElementById('btn-subtab-pagos');
  const vistaCreditos = document.getElementById('subvista-creditos');
  const vistaPagos = document.getElementById('subvista-pagos');

  if (tab === 'creditos') {
    btnCreditos.classList.add('active');
    btnPagos.classList.remove('active');
    vistaCreditos.style.display = 'block';
    vistaPagos.style.display = 'none';
  } else {
    btnPagos.classList.add('active');
    btnCreditos.classList.remove('active');
    vistaCreditos.style.display = 'none';
    vistaPagos.style.display = 'block';
  }
}

function imprimirTicketPrueba() {
  imprimirTicketCorporativo({
    tipo: 'COMPROBANTE DE PAGO (PRUEBA)',
    nroRecibo: '0001-00000001',
    cliente: {
      nombre: 'GÓMEZ MARIO ALBERTO',
      dni: '32.441.982',
      telefono: '3843-404771',
      direccion: 'B° Belgrano'
    },
    garante: { nombre: 'PÉREZ HÉCTOR JOSÉ', dni: '28.990.112' },
    concepto: 'SMART TV 43" FULL HD NOBLEX',
    cuotaInfo: 'Cuota 2 de 6',
    fechaVencimiento: '10/11/2026',
    montoPuro: 35000.00,
    montoMora: 1500.00,
    totalCobrado: 36500.00,
    totalCredito: 210000.00,
    saldoRestante: 140000.00,
    cuotasRestantes: 4,
    metodo: 'EFECTIVO'
  });
}

function imprimirTicketCorporativo(data) {
  const cfg = configNegocioActual || {};
  const anchoMm = cfg.ancho_ticket || '80mm';
  const fechaHora = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  let anchoUtil = '72mm';
  let fontSizeGeneral = '12px';
  if (anchoMm === '100mm') { anchoUtil = '92mm'; fontSizeGeneral = '13px'; }
  if (anchoMm === '58mm')  { anchoUtil = '50mm'; fontSizeGeneral = '10px'; }

  const logoHtml = cfg.logo_base64 
    ? `<div style="text-align:center; margin-bottom:6px;"><img src="${cfg.logo_base64}" style="max-width:130px; max-height:65px; filter:grayscale(100%) contrast(150%);"></div>` 
    : '';

  const garanteHtml = (data.garante && data.garante.nombre) 
    ? `<div style="margin-top:3px; padding-top:3px; border-top:1px dotted #555;">
         <span style="font-weight:bold;">GARANTE SOLIDARIO:</span><br>
         ${data.garante.nombre} ${data.garante.dni ? '(DNI: ' + data.garante.dni + ')' : ''}
       </div>`
    : '';

  const win = window.open('', '_blank', 'width=460,height=650');
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${data.tipo}</title>
      <style>
        @page { size: ${anchoMm} auto; margin: 0; }
        body { font-family: 'Courier New', Courier, monospace; width: ${anchoUtil}; margin: 0 auto; padding: 10px 4px; color: #000; font-size: ${fontSizeGeneral}; line-height: 1.25; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .line-solid { border-top: 2px solid #000; margin: 6px 0; }
        .line-dash { border-top: 1px dashed #000; margin: 5px 0; }
        .row { display: flex; justify-content: space-between; }
        .box-total { border: 1px solid #000; padding: 6px; margin: 6px 0; text-align: center; }
        .barcode { font-family: monospace; letter-spacing: 5px; font-size: 16px; font-weight: bold; text-align: center; margin-top: 4px; }
      </style>
    </head>
    <body onload="window.print(); window.close();">
      ${logoHtml}
      <div class="center bold" style="font-size: 15px;">${cfg.nombre_negocio || 'ULTRACUOTAS'}</div>
      <div class="center" style="font-size: 11px;">CRÉDITOS Y COBRANZAS COMERCIALES</div>
      <div class="center">${cfg.direccion || 'Quimilí - Santiago del Estero'}</div>
      <div class="center">TEL/WSP: ${cfg.telefono || '3843-404771'}</div>
      
      <div class="line-solid"></div>
      <div class="center bold" style="font-size: 13px;">${data.tipo}</div>
      <div class="center bold">N° ${data.nroRecibo || '0001-00001024'}</div>
      <div class="row"><span>FECHA/HORA:</span><span>${fechaHora}</span></div>
      <div class="row"><span>OPERADOR:</span><span>${usuarioSesion ? usuarioSesion.usuario.toUpperCase() : 'ADMIN'}</span></div>

      <div class="line-solid"></div>
      <div class="bold">DATOS DEL ABONADO:</div>
      <div>TITULAR: <strong>${data.cliente.nombre}</strong></div>
      ${data.cliente.dni ? `<div>DNI/CUIT: ${data.cliente.dni}</div>` : ''}
      ${data.cliente.telefono ? `<div>TELÉFONO: ${data.cliente.telefono}</div>` : ''}
      ${data.cliente.direccion ? `<div>DOMICILIO: ${data.cliente.direccion}</div>` : ''}
      ${garanteHtml}

      <div class="line-solid"></div>
      <div class="bold">DETALLE DE LA OPERACIÓN:</div>
      <div>CONCEPTO: ${data.concepto}</div>
      <div class="row"><span>PERÍODO/CUOTA:</span><span class="bold">${data.cuotaInfo}</span></div>
      ${data.fechaVencimiento ? `<div class="row"><span>VENCIMIENTO:</span><span>${data.fechaVencimiento}</span></div>` : ''}
      
      <div class="line-dash"></div>
      <div class="row"><span>CUOTA PURA:</span><span>$${data.montoPuro.toFixed(2)}</span></div>
      ${data.montoMora > 0 ? `<div class="row"><span>RECARGO POR MORA:</span><span>+$${data.montoMora.toFixed(2)}</span></div>` : ''}

      <div class="box-total">
        <span style="font-size: 11px; font-weight: bold;">TOTAL PERCIBIDO</span>
        <div class="bold" style="font-size: 18px;">$${data.totalCobrado.toFixed(2)}</div>
        <div style="font-size: 11px;">FORMA DE PAGO: ${data.metodo}</div>
      </div>

      <div class="line-solid"></div>
      <div class="bold center">ESTADO DE CUENTA ACTUALIZADO</div>
      ${data.totalCredito ? `<div class="row"><span>TOTAL CRÉDITO:</span><span>$${data.totalCredito.toFixed(2)}</span></div>` : ''}
      <div class="row bold"><span>SALDO DEUDOR RESTANTE:</span><span>$${data.saldoRestante.toFixed(2)}</span></div>
      <div class="row"><span>CUOTAS PENDIENTES:</span><span>${data.cuotasRestantes}</span></div>

      <div class="line-dash"></div>
      <div class="center" style="font-size: 10px; margin: 4px 0;">
        ${cfg.mensaje_pie || 'Conserve este comprobante como constancia legal de pago.'}
      </div>

      <div style="margin-top: 35px; text-align: center;">
        <div style="width: 75%; border-top: 1px solid #000; margin: 0 auto;"></div>
        <span style="font-size: 10px;">FIRMA Y ACLARACIÓN DEL ABONADO</span>
      </div>

      <div class="barcode">||| | ||||| || |||| ||</div>
      <div class="center" style="font-size: 9px;">SISTEMA ULTRACUOTAS POS v2.6</div>
    </body>
    </html>
  `);
  win.document.close();
}

async function cargarListaUsuarios() {
  try {
    const res = await fetch(`${API_BASE}/api/usuarios`);
    const usuarios = await res.json();
    const tbody = document.getElementById('tabla-usuarios-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    usuarios.forEach(u => {
      if (u.usuario === 'soporte') return;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${u.nombre}</strong></td>
        <td>${u.usuario}</td>
        <td><span class="status-badge ${u.rol === 'ADMIN' ? 'status-pagada' : 'status-parcial'}">${u.rol}</span></td>
        <td style="text-align:center; display: flex; justify-content: center; gap: 8px;">
          <button class="btn-badge btn-warning" onclick="abrirModalCambioClave(${u.id}, '${u.usuario}')">🔑 Cambiar Clave</button>
          ${u.usuario !== 'admin' ? `
            <button class="btn-badge btn-danger" onclick="eliminarUsuario(${u.id}, '${u.usuario}')">Eliminar</button>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {}
}

function abrirModalCambioClave(id, usuario) {
  document.getElementById('cambio-clave-usr-id').value = id;
  document.getElementById('lbl-cambiar-clave-user').textContent = `Usuario: ${usuario}`;
  document.getElementById('cambio-clave-input').value = '';
  document.getElementById('modal-cambiar-clave').classList.add('open');
}

function cerrarModalCambioClave() {
  const m = document.getElementById('modal-cambiar-clave');
  if (m) m.classList.remove('open');
}

async function guardarNuevaClaveUsuario(e) {
  e.preventDefault();
  const id = document.getElementById('cambio-clave-usr-id').value;
  const clave = document.getElementById('cambio-clave-input').value;

  try {
    const res = await fetch(`${API_BASE}/api/usuarios/${id}/clave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave })
    });

    if (res.ok) {
      alert('✅ Contraseña actualizada con éxito.');
      cerrarModalCambioClave();
    } else {
      const err = await res.json();
      alert(err.error || 'Error al actualizar contraseña');
    }
  } catch (error) {
    alert('Error de conexión al actualizar la clave');
  }
}

async function crearNuevoCajero(e) {
  e.preventDefault();
  const nombre = document.getElementById('nuevo-usr-nombre').value.trim();
  const usuario = document.getElementById('nuevo-usr-usuario').value.trim();
  const clave = document.getElementById('nuevo-usr-clave').value.trim();
  const rol = document.getElementById('nuevo-usr-rol').value;

  if (usuario.toLowerCase() === 'soporte') {
    alert('Nombre reservado');
    return;
  }

  const res = await fetch(`${API_BASE}/api/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, usuario, clave, rol })
  });

  if (res.ok) {
    alert('Cajero creado con éxito');
    document.getElementById('nuevo-usr-nombre').value = '';
    document.getElementById('nuevo-usr-usuario').value = '';
    document.getElementById('nuevo-usr-clave').value = '';
    cargarListaUsuarios();
  } else {
    const err = await res.json();
    alert(err.error || 'Error al crear cajero');
  }
}

async function eliminarUsuario(id, usuario) {
  if (!confirm(`¿Desea eliminar al usuario "${usuario}"?`)) return;
  const res = await fetch(`${API_BASE}/api/usuarios/${id}`, { method: 'DELETE' });
  if (res.ok) {
    alert('Usuario eliminado');
    cargarListaUsuarios();
  } else {
    const err = await res.json();
    alert(err.error || 'No se pudo eliminar');
  }
}

function abrirModal(id) {
  const cli = listaClientes.find(c => c.id === id);
  if (!cli) return;

  document.getElementById('edit-id').value = cli.id;
  document.getElementById('edit-nombre').value = cli.nombre;
  document.getElementById('edit-dni').value = cli.dni || '';
  document.getElementById('edit-telefono').value = cli.telefono || '';
  document.getElementById('edit-direccion').value = cli.direccion || '';
  document.getElementById('edit-notas').value = cli.notas || '';

  document.getElementById('modal-editar').classList.add('open');
}

function cerrarModal() {
  const m = document.getElementById('modal-editar');
  if (m) m.classList.remove('open');
}

async function guardarEdicion(e) {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const datos = {
    nombre: document.getElementById('edit-nombre').value,
    dni: document.getElementById('edit-dni').value,
    telefono: document.getElementById('edit-telefono').value,
    direccion: document.getElementById('edit-direccion').value,
    notas: document.getElementById('edit-notas').value
  };

  const res = await fetch(`${API_BASE}/api/clientes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert('Datos actualizados');
    cerrarModal();

    if (clienteSeleccionadoActual && clienteSeleccionadoActual.id == id) {
      clienteSeleccionadoActual = { ...clienteSeleccionadoActual, ...datos };
      document.getElementById('ficha-nombre').textContent = datos.nombre;
      document.getElementById('ficha-info').textContent = `DNI: ${datos.dni || 'S/D'} • Tel: ${datos.telefono || '-'} • Dir: ${datos.direccion || '-'}`;
    }

    await iniciarCobranzas();
    cargarClientes();
  } else {
    alert('Error al modificar');
  }
}

async function guardarCliente(e) {
  e.preventDefault();
  const datos = {
    nombre: document.getElementById('cli-nombre').value,
    dni: document.getElementById('cli-dni').value,
    telefono: document.getElementById('cli-telefono').value,
    direccion: document.getElementById('cli-direccion').value,
    notas: document.getElementById('cli-notas').value
  };

  const res = await fetch(`${API_BASE}/api/clientes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  });

  if (res.ok) {
    alert('Abonado registrado correctamente');
    document.getElementById('form-cliente').reset();
    cargarClientes();
    iniciarCobranzas();
  }
}

async function cargarSelectClientes() {
  const res = await fetch(`${API_BASE}/api/clientes`);
  const clientes = await res.json();
  const select = document.getElementById('venta-cliente');
  if (!select) return;
  select.innerHTML = '<option value="">Seleccionar abonado...</option>';
  clientes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.nombre} (DNI: ${c.dni || 'S/D'})`;
    select.appendChild(opt);
  });
}

async function cargarClientes() {
  const res = await fetch(`${API_BASE}/api/clientes`);
  const clientes = await res.json();
  listaClientes = clientes;
  const tbody = document.getElementById('tabla-clientes-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (clientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No hay abonados registrados.</td></tr>';
    return;
  }

  clientes.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.id}</td>
      <td><strong>${c.nombre}</strong></td>
      <td>${c.dni || '-'}</td>
      <td>${c.telefono || '-'}</td>
      <td>${c.direccion || '-'}</td>
      <td>
        <button class="btn-badge btn-warning" onclick="abrirModal(${c.id})">Editar</button>
        <button class="btn-badge btn-danger" onclick="eliminarCliente(${c.id}, '${c.nombre.replace(/'/g, "\\'")}')">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function eliminarCliente(id, nom) {
  if (!confirm(`¿Eliminar al abonado "${nom}"?`)) return;
  const res = await fetch(`${API_BASE}/api/clientes/${id}`, { method: 'DELETE' });
  if (res.ok) {
    alert('Abonado eliminado');
    cargarClientes();
    iniciarCobranzas();
  } else {
    const err = await res.json();
    alert(err.error || 'No se pudo eliminar');
  }
}

function alternarTema() {
  const isDark = document.body.classList.toggle('dark-mode');
  const ico = document.getElementById('theme-ico');
  ico.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('tema_app', isDark ? 'oscuro' : 'claro');
}

if (localStorage.getItem('tema_app') === 'oscuro') {
  document.body.classList.add('dark-mode');
  const ico = document.getElementById('theme-ico');
  if (ico) ico.textContent = '☀️';
}

async function actualizarAlertas() {
  try {
    const res = await fetch(`${API_BASE}/api/alertas-vencimientos`);
    const alertas = await res.json();
    const badge = document.getElementById('badge-contador-alertas');
    const lista = document.getElementById('lista-alertas-notif');

    if (badge) {
      if (alertas.length > 0) {
        badge.textContent = alertas.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (lista) {
      lista.innerHTML = '';
      if (alertas.length === 0) {
        lista.innerHTML = '<div style="text-align:center; padding:20px; font-size:13px; color:var(--text-muted);">🎉 ¡No hay vencimientos pendientes ni atrasos!</div>';
        return;
      }

      alertas.forEach(a => {
        const esVencida = a.tipo_alerta === 'VENCIDA';
        const item = document.createElement('div');
        item.className = `notif-item ${esVencida ? 'vencida' : 'por-vencer'}`;

        const mensajeWsp = encodeURIComponent(
          `Hola ${a.cliente_nombre}, le informamos que ${esVencida ? 'su cuota se encuentra vencida' : 'está próxima a vencer su cuota'} de ${a.producto} (Cuota N° ${a.numero_cuota}) por $${a.resto_pendiente.toFixed(2)}. Recuerde que los vencimientos operan del 1 al 10 de cada mes.`
        );

        let htmlGarante = '';
        if (a.garante_nombre && a.garante_telefono) {
          const mensajeWspGarante = encodeURIComponent(
            `Estimado/a ${a.garante_nombre}, nos comunicamos en carácter de Garante de ${a.cliente_nombre}. Le recordamos que registra una cuota pendiente de ${a.producto} por $${a.resto_pendiente.toFixed(2)}.`
          );
          htmlGarante = `
            <div style="margin-top: 5px; font-size:11px;">
              <span>Garante: ${a.garante_nombre}</span>
              <button class="btn-wsp" style="padding:2px 6px; font-size:10px; margin-left:4px;" onclick="window.open('https://wa.me/${a.garante_telefono.replace(/[^0-9]/g, '')}?text=${mensajeWspGarante}', '_blank')">
                WSP Garante
              </button>
            </div>
          `;
        }

        item.innerHTML = `
          <div class="notif-info">
            <strong>${a.cliente_nombre}</strong>
            <span>${a.producto} • Cuota ${a.numero_cuota} ($${a.resto_pendiente.toFixed(2)})</span>
            <span style="display:block; color:${esVencida ? 'var(--danger)' : 'var(--warning)'}; font-weight:700;">
              ${esVencida ? `⚠️ Venció el ${a.fecha_vencimiento}` : `⏳ Vence el ${a.fecha_vencimiento}`}
            </span>
            ${htmlGarante}
          </div>
          ${a.cliente_telefono ? `
            <button class="btn-wsp" onclick="window.open('https://wa.me/${a.cliente_telefono.replace(/[^0-9]/g, '')}?text=${mensajeWsp}', '_blank')">
              WhatsApp
            </button>
          ` : '<span style="font-size:11px; color:var(--text-muted);">Sin Tel.</span>'}
        `;
        lista.appendChild(item);
      });
    }
  } catch (err) {}
}

function alternarPanelAlertas(e) {
  if (e) e.stopPropagation();
  const p = document.getElementById('panel-alertas-flotante');
  if (p) p.classList.toggle('open');
}

function cerrarPanelAlertas() {
  const p = document.getElementById('panel-alertas-flotante');
  if (p) p.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('panel-alertas-flotante');
  if (panel && !panel.contains(e.target) && !e.target.closest('.notif-btn')) {
    panel.classList.remove('open');
  }
});

function verPestana(id, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const target = document.getElementById('panel-' + id);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');

  if (id === 'cobranzas') iniciarCobranzas();
  if (id === 'caja') cargarEstadoCaja();
  if (id === 'config') cargarConfiguracion();
  if (id === 'cartera') cargarClientes();
  if (id === 'operacion') {
    cargarSelectClientes();
    seleccionarTipoOperacion('ARTICULO');
  }
}

const formLoginElem = document.getElementById('form-login');
if (formLoginElem) {
  formLoginElem.addEventListener('submit', ejecutarLogin);
}

verificarSesionPrevia();