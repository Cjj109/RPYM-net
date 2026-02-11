import { useState, useEffect } from 'react';
import type { ThemeName } from '../lib/d1-types';

interface BCVRateData {
  rate: number;
  date: string;
  source: string;
}

interface Props {
  currentBcvRate: BCVRateData;
}

interface ThemeConfig {
  id: ThemeName;
  name: string;
  description: string;
  colors: string[];
  icon: string;
}

interface PasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const THEMES: ThemeConfig[] = [
  {
    id: 'ocean',
    name: 'Oceano',
    description: 'Azul marino y coral (default)',
    colors: ['#0c4a6e', '#0ea5e9', '#f97316'],
    icon: '🌊'
  },
  {
    id: 'carnival',
    name: 'Carnaval',
    description: 'Morado, dorado y verde',
    colors: ['#7e22ce', '#a855f7', '#eab308'],
    icon: '🎭'
  },
  {
    id: 'christmas',
    name: 'Navidad',
    description: 'Rojo, verde y dorado',
    colors: ['#b91c1c', '#ef4444', '#22c55e'],
    icon: '🎄'
  },
  {
    id: 'easter',
    name: 'Pascua',
    description: 'Rosa pastel, azul y amarillo',
    colors: ['#be185d', '#ec4899', '#0ea5e9'],
    icon: '🐰'
  },
  {
    id: 'valentine',
    name: 'San Valentin',
    description: 'Rosa, rojo y dorado',
    colors: ['#e11d48', '#f43f5e', '#f59e0b'],
    icon: '💕'
  },
  {
    id: 'mundial',
    name: 'Mundial 2026',
    description: 'Verde cancha y dorado trofeo',
    colors: ['#16a34a', '#22c55e', '#eab308'],
    icon: '⚽'
  },
  {
    id: 'halloween',
    name: 'Halloween',
    description: 'Naranja, morado y negro',
    colors: ['#f97316', '#9333ea', '#1c1917'],
    icon: '🎃'
  },
];

export default function AdminSettings({ currentBcvRate }: Props) {
  const [selectedTheme, setSelectedTheme] = useState<ThemeName>('ocean');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [themeMessage, setThemeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [useManualRate, setUseManualRate] = useState(false);
  const [manualRate, setManualRate] = useState('');
  const [isSavingRate, setIsSavingRate] = useState(false);
  const [rateMessage, setRateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change state
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load current config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Load theme
        const themeRes = await fetch('/api/config/theme');
        if (themeRes.ok) {
          const { theme } = await themeRes.json();
          setSelectedTheme(theme);
        }

        // Load BCV rate config
        const rateRes = await fetch('/api/config/bcv-rate');
        if (rateRes.ok) {
          const data = await rateRes.json();
          setUseManualRate(data.manual);
          if (data.manual && data.rate) {
            setManualRate(data.rate.toString());
          }
        }
      } catch (error) {
        console.error('Error loading config:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    };
    loadConfig();
  }, []);

  const handleSaveTheme = async () => {
    setIsSavingTheme(true);
    setThemeMessage(null);
    try {
      const response = await fetch('/api/config/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: selectedTheme })
      });

      if (response.ok) {
        // Update localStorage and apply immediately
        localStorage.setItem('rpym_theme', selectedTheme);
        document.documentElement.setAttribute('data-theme', selectedTheme);

        // Update meta theme-color
        const themeColors: Record<ThemeName, string> = {
          ocean: '#0c4a6e',
          carnival: '#7e22ce',
          christmas: '#b91c1c',
          easter: '#be185d',
          valentine: '#e11d48',
          mundial: '#16a34a',
          halloween: '#f97316'
        };
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[selectedTheme]);

        setThemeMessage({
          type: 'success',
          text: 'Tema actualizado. Todos los usuarios lo veran en unos segundos.'
        });
      } else {
        setThemeMessage({ type: 'error', text: 'Error al guardar el tema' });
      }
    } catch (error) {
      setThemeMessage({ type: 'error', text: 'Error de conexion' });
    } finally {
      setIsSavingTheme(false);
    }
  };

  const handleSaveRate = async () => {
    setIsSavingRate(true);
    setRateMessage(null);

    // Validate manual rate
    if (useManualRate) {
      const rate = parseFloat(manualRate);
      if (isNaN(rate) || rate <= 0) {
        setRateMessage({ type: 'error', text: 'Ingresa una tasa valida mayor a 0' });
        setIsSavingRate(false);
        return;
      }
    }

    try {
      const response = await fetch('/api/config/bcv-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual: useManualRate,
          rate: useManualRate ? parseFloat(manualRate) : null
        })
      });

      if (response.ok) {
        setRateMessage({
          type: 'success',
          text: useManualRate
            ? 'Tasa manual configurada. Se usara en nuevos presupuestos.'
            : 'Tasa automatica activada. Se usara la tasa del BCV.'
        });
      } else {
        setRateMessage({ type: 'error', text: 'Error al guardar la configuracion' });
      }
    } catch (error) {
      setRateMessage({ type: 'error', text: 'Error de conexion' });
    } finally {
      setIsSavingRate(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMessage(null);

    // Validations
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Todos los campos son requeridos' });
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'La nueva contrasena debe tener al menos 8 caracteres' });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Las contrasenas nuevas no coinciden' });
      return;
    }

    setIsChangingPassword(true);

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        setPasswordMessage({ type: 'success', text: 'Contrasena actualizada exitosamente' });
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setPasswordMessage({ type: 'error', text: data.error || 'Error al cambiar contrasena' });
      }
    } catch (error) {
      setPasswordMessage({ type: 'error', text: 'Error de conexion' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-ocean-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-ocean-600">Cargando configuracion...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Theme Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
        <h2 className="text-lg font-semibold text-ocean-900 mb-2 flex items-center gap-2">
          <span className="text-2xl">🎨</span>
          Tema del Sitio
        </h2>
        <p className="text-sm text-ocean-600 mb-4">
          El tema seleccionado se aplicara a <strong>todos los usuarios</strong> en tiempo real (menos de 30 segundos).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setSelectedTheme(theme.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                selectedTheme === theme.id
                  ? 'border-ocean-500 bg-ocean-50 ring-2 ring-ocean-200'
                  : 'border-ocean-200 hover:border-ocean-300 hover:bg-ocean-50/50'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{theme.icon}</span>
                <div className="flex -space-x-1">
                  {theme.colors.map((color, i) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <p className="font-medium text-ocean-900">{theme.name}</p>
              <p className="text-xs text-ocean-600">{theme.description}</p>
            </button>
          ))}
        </div>

        {themeMessage && (
          <div className={`text-sm p-3 rounded-lg mb-4 ${
            themeMessage.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {themeMessage.text}
          </div>
        )}

        <button
          onClick={handleSaveTheme}
          disabled={isSavingTheme}
          className="px-6 py-2.5 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300
            text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {isSavingTheme ? (
            <>
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
              Guardando...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Guardar Tema
            </>
          )}
        </button>
      </div>

      {/* BCV Rate Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
        <h2 className="text-lg font-semibold text-ocean-900 mb-2 flex items-center gap-2">
          <span className="text-2xl">💵</span>
          Tasa BCV
        </h2>
        <p className="text-sm text-ocean-600 mb-4">
          Configura la tasa de cambio para calcular precios en Bolivares.
        </p>

        {/* Current auto rate display */}
        <div className="bg-gradient-to-r from-ocean-50 to-ocean-100 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm text-ocean-600 mb-1">Tasa automatica actual</p>
              <p className="text-2xl font-bold text-ocean-900">
                Bs. {currentBcvRate.rate.toFixed(2)}
              </p>
            </div>
            <div className="text-right text-sm text-ocean-600">
              <p className="flex items-center gap-1 justify-end">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Fuente: {currentBcvRate.source}
              </p>
              <p>{currentBcvRate.date}</p>
            </div>
          </div>
        </div>

        {/* Manual rate toggle */}
        <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              checked={useManualRate}
              onChange={(e) => setUseManualRate(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ocean-200 peer-focus:ring-4 peer-focus:ring-ocean-300 rounded-full
              peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-['']
              after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300
              after:border after:rounded-full after:h-5 after:w-5 after:transition-all
              peer-checked:bg-ocean-600"></div>
          </div>
          <span className="text-ocean-900 font-medium">Usar tasa manual (override)</span>
        </label>

        {/* Manual rate input */}
        {useManualRate && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <label className="block text-sm font-medium text-amber-800 mb-2">
              Tasa manual (Bs. por USD)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-ocean-600">Bs.</span>
              <input
                type="number"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                step="0.01"
                min="0"
                placeholder="Ej: 72.50"
                className="w-32 px-3 py-2 border border-amber-300 rounded-lg
                  focus:ring-2 focus:ring-amber-500 focus:border-transparent
                  bg-white text-ocean-900"
              />
            </div>
            <p className="text-xs text-amber-700 mt-2">
              Esta tasa se usara en lugar de la tasa automatica del BCV.
            </p>
          </div>
        )}

        {rateMessage && (
          <div className={`text-sm p-3 rounded-lg mb-4 ${
            rateMessage.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {rateMessage.text}
          </div>
        )}

        <button
          onClick={handleSaveRate}
          disabled={isSavingRate}
          className="px-6 py-2.5 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300
            text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {isSavingRate ? (
            <>
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
              Guardando...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Guardar Configuracion
            </>
          )}
        </button>
      </div>

      {/* Password Change Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
        <h2 className="text-lg font-semibold text-ocean-900 mb-2 flex items-center gap-2">
          <span className="text-2xl">🔐</span>
          Cambiar Contrasena
        </h2>
        <p className="text-sm text-ocean-600 mb-4">
          Actualiza tu contrasena de acceso al panel de administracion.
        </p>

        <div className="space-y-4 max-w-md">
          {/* Current Password */}
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">
              Contrasena actual
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                placeholder="Ingresa tu contrasena actual"
                className="w-full px-4 py-2.5 pr-10 border border-ocean-200 rounded-lg
                  focus:ring-2 focus:ring-ocean-500 focus:border-transparent
                  text-ocean-900 placeholder-ocean-400"
              />
            </div>
          </div>

          {/* New Password */}
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">
              Nueva contrasena
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
              placeholder="Minimo 8 caracteres"
              className="w-full px-4 py-2.5 border border-ocean-200 rounded-lg
                focus:ring-2 focus:ring-ocean-500 focus:border-transparent
                text-ocean-900 placeholder-ocean-400"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">
              Confirmar nueva contrasena
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
              placeholder="Repite la nueva contrasena"
              className="w-full px-4 py-2.5 border border-ocean-200 rounded-lg
                focus:ring-2 focus:ring-ocean-500 focus:border-transparent
                text-ocean-900 placeholder-ocean-400"
            />
          </div>

          {/* Show passwords toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-ocean-600">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded border-ocean-300 text-ocean-600 focus:ring-ocean-500"
            />
            Mostrar contrasenas
          </label>

          {passwordMessage && (
            <div className={`text-sm p-3 rounded-lg ${
              passwordMessage.type === 'error'
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}>
              {passwordMessage.text}
            </div>
          )}

          <button
            onClick={handleChangePassword}
            disabled={isChangingPassword}
            className="px-6 py-2.5 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300
              text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {isChangingPassword ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                Cambiando...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                Cambiar Contrasena
              </>
            )}
          </button>
        </div>
      </div>

      {/* Info Section */}
      <div className="bg-ocean-50 rounded-xl p-4 border border-ocean-200">
        <h3 className="font-medium text-ocean-900 mb-2 flex items-center gap-2">
          <svg className="w-5 h-5 text-ocean-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Informacion
        </h3>
        <ul className="text-sm text-ocean-700 space-y-1">
          <li>• Los cambios de tema se aplican a todos los visitantes en menos de 30 segundos.</li>
          <li>• La tasa BCV se actualiza automaticamente diariamente.</li>
          <li>• Usa la tasa manual solo si necesitas un valor especifico temporal.</li>
        </ul>
      </div>
    </div>
  );
}
