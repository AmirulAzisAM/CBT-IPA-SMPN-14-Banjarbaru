// Initialize SDKs with error handling
let dataSdkReady = false;
let elementSdkReady = false;

// Async SDK initialization with timeout
const sdkTimeout = setTimeout(() => {
    console.warn('SDK initialization timeout - continuing without full SDK features');
    elementSdkReady = true;
}, 5000);

Promise.all([
    window.dataSdk.init({
        onDataChanged(data) {
            allAnalysisData = data || [];
            if (currentState === 'admin') {
                renderAnalysis();
            }
        }
    }).catch(err => console.error('Data SDK init error:', err)),
    new Promise(resolve => {
        window.elementSdk.init({
            defaultConfig: {},
            onConfigChange: async (config) => {},
            mapToCapabilities: (config) => ({
                recolorables: [],
                borderables: [],
                fontEditable: undefined,
                fontSizeable: undefined
            }),
            mapToEditPanelValues: (config) => new Map()
        });
        resolve();
    })
]).then(() => {
    clearTimeout(sdkTimeout);
    dataSdkReady = true;
    elementSdkReady = true;
    lucide.createIcons();
}).catch(err => {
    console.error('SDK initialization error:', err);
    elementSdkReady = true;
    lucide.createIcons();
});

// Constants
const ADMIN_PASSWORD = 'admin123';
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbyFuHfb8Z1u6CM9ajKv4_lV04uNYHQ8nxCwF50ZaPyaWahQGCDcLgWOnAgKYjUwnznJ/exec';
const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Anti-Cheat Configuration
const ANTI_CHEAT_CONFIG = {
    warningDelayMs: 1500,
    logoutDelayMs: 10000,
    checkIntervalMs: 300,
    mobileTolerance: 3000,
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
};

// State Management
let currentState = 'login';
let currentTab = 'student';
let currentQuestion = 0;
let questions = [];
let userAnswers = {};
let sessionData = {};
let examStartTime = null;
let timerInterval = null;
let antiCheatWarningActive = false;
let antiCheatWarningTimer = null;
let tokenRefreshInterval = null;
let currentToken = generateToken();
let tokenLastRefresh = Date.now();
let storedAnswers = {};
let lastActivityTime = Date.now();
let antiCheatCheckInterval = null;
let violationCount = 0;
let lastViolationTime = 0;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const preExamScreen = document.getElementById('preExamScreen');
const examScreen = document.getElementById('examScreen');
const adminScreen = document.getElementById('adminScreen');
const resultScreen = document.getElementById('resultScreen');

// Wizard State
let currentStep = 1;

// Initialize Event Listeners
setupLoginHandlers();
setupAdminHandlers();
setupExamHandlers();
setupPreExamHandlers();
startTokenRefresh();

lucide.createIcons();

// ─── Pre-Exam Handlers ────────────────────────────────────────────────────────

function setupPreExamHandlers() {
    const startExamBtn = document.getElementById('startExamBtn');
    const cancelPreExamBtn = document.getElementById('cancelPreExamBtn');

    startExamBtn.addEventListener('click', () => {
        proceedWithExam();
    });

    cancelPreExamBtn.addEventListener('click', () => {
        currentState = 'login';
        preExamScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    });
}

// ─── Wizard Functions ─────────────────────────────────────────────────────────

function goToStep(step) {
    if (step < 1 || step > 3) return;

    if (step > currentStep) {
        if (!validateStep(currentStep)) return;
    }

    currentStep = step;

    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');

    document.getElementById(`step${step}`).classList.remove('hidden');

    updateStepIndicators();
    updateWizardButtons();
}

function updateStepIndicators() {
    for (let i = 1; i <= 3; i++) {
        const indicator = document.getElementById(`step${i}Indicator`);
        const circle = indicator.querySelector('div');
        const line = document.getElementById(`stepLine${i}`);

        if (i < currentStep) {
            circle.style.backgroundColor = '#22c55e';
            circle.innerHTML = '<i data-lucide="check" class="w-5 h-5"></i>';
            if (line) line.style.backgroundColor = '#22c55e';
        } else if (i === currentStep) {
            circle.style.backgroundColor = '#3b82f6';
            circle.textContent = i;
            if (line) line.style.backgroundColor = '#64748b';
        } else {
            circle.style.backgroundColor = '#64748b';
            circle.textContent = i;
            if (line) line.style.backgroundColor = '#64748b';
        }
    }
    lucide.createIcons();
}

function updateWizardButtons() {
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const submitBtn = document.getElementById('submitLoginBtn');

    if (currentStep === 1) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }

    if (currentStep === 3) {
        nextBtn.classList.add('hidden');
        submitBtn.classList.remove('hidden');
    } else {
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');
    }
}

function validateStep(step) {
    if (step === 1) {
        const name = document.getElementById('studentName').value.trim();
        const nameError = document.getElementById('nameError');

        if (!name) {
            nameError.textContent = 'Nama harus diisi';
            nameError.classList.remove('hidden');
            return false;
        }
        nameError.classList.add('hidden');
        return true;
    }

    if (step === 2) {
        const number = document.getElementById('studentNumber').value.trim();
        const className = document.getElementById('studentClass').value;
        const numberError = document.getElementById('numberError');
        const classError = document.getElementById('classError');

        let valid = true;
        if (!number || isNaN(number)) {
            numberError.textContent = 'Nomor siswa harus berupa angka';
            numberError.classList.remove('hidden');
            valid = false;
        } else {
            numberError.classList.add('hidden');
        }

        if (!className) {
            classError.textContent = 'Pilih kelas';
            classError.classList.remove('hidden');
            valid = false;
        } else {
            classError.classList.add('hidden');
        }

        return valid;
    }

    return true;
}

function proceedWithExam() {
    try {
        currentState = 'exam';
        examStartTime = Date.now();

        const stored = localStorage.getItem(`answers_${sessionData.number}`);
        if (stored) {
            userAnswers = JSON.parse(stored);
        }

        questions = getQuestionsForSubject(sessionData.subject);

        if (!questions || questions.length === 0) {
            showErrorMessage(`Belum ada soal untuk mata pelajaran ${sessionData.subject}`);
            currentState = 'preExam';
            return;
        }

        const shuffledKey = `shuffled_${sessionData.number}`;
        const storedShuffled = sessionStorage.getItem(shuffledKey);
        if (storedShuffled) {
            questions = JSON.parse(storedShuffled);
        } else {
            questions = shuffleOptionsOnly(questions);
            sessionStorage.setItem(shuffledKey, JSON.stringify(questions));
        }

        currentQuestion = 0;

        document.getElementById('examTitle').textContent = `Ujian ${sessionData.subject}`;
        document.getElementById('studentInfo').textContent = `${sessionData.name} | Kelas ${sessionData.className} | ${sessionData.number}`;

        renderQuestionNav();
        renderQuestion();
        startTimer();

        preExamScreen.classList.add('hidden');
        examScreen.classList.remove('hidden');

        setupAntiCheat();
    } catch (error) {
        console.error('Error in proceedWithExam:', error);
        showErrorMessage('Terjadi kesalahan saat memulai ujian. Silakan coba lagi.');
        currentState = 'preExam';
    }
}

// ─── Login Handlers ───────────────────────────────────────────────────────────

function setupLoginHandlers() {
    const studentTabBtn = document.getElementById('studentTabBtn');
    const adminTabBtn = document.getElementById('adminTabBtn');
    const studentLoginForm = document.getElementById('studentLoginForm');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const togglePassword = document.getElementById('togglePassword');
    const adminPassword = document.getElementById('adminPassword');
    const prevStepBtn = document.getElementById('prevStepBtn');
    const nextStepBtn = document.getElementById('nextStepBtn');

    studentTabBtn.addEventListener('click', () => switchTab('student'));
    adminTabBtn.addEventListener('click', () => switchTab('admin'));

    togglePassword.addEventListener('click', () => {
        const type = adminPassword.getAttribute('type') === 'password' ? 'text' : 'password';
        adminPassword.setAttribute('type', type);
        togglePassword.innerHTML = type === 'password'
            ? '<i data-lucide="eye" class="w-5 h-5"></i>'
            : '<i data-lucide="eye-off" class="w-5 h-5"></i>';
        lucide.createIcons();
    });

    studentLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleStudentLogin();
    });

    adminLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAdminLogin();
    });

    prevStepBtn.addEventListener('click', () => {
        goToStep(currentStep - 1);
    });

    nextStepBtn.addEventListener('click', () => {
        goToStep(currentStep + 1);
    });

    document.getElementById('studentNumber').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    document.getElementById('studentToken').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
}

function switchTab(tab) {
    currentTab = tab;
    currentStep = 1;

    const studentLogin = document.getElementById('studentLogin');
    const adminLogin = document.getElementById('adminLogin');
    const studentTabBtn = document.getElementById('studentTabBtn');
    const adminTabBtn = document.getElementById('adminTabBtn');

    if (tab === 'student') {
        studentLogin.classList.remove('hidden');
        adminLogin.classList.add('hidden');
        studentTabBtn.style.backgroundColor = '#3b82f6';
        studentTabBtn.style.color = 'white';
        adminTabBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        adminTabBtn.style.color = '#cbd5e1';
        goToStep(1);
    } else {
        studentLogin.classList.add('hidden');
        adminLogin.classList.remove('hidden');
        adminTabBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        adminTabBtn.style.color = '#cbd5e1';
        studentTabBtn.style.backgroundColor = '#3b82f6';
        studentTabBtn.style.color = 'white';
    }
    clearErrors();
}

function handleStudentLogin() {
    const name = document.getElementById('studentName').value.trim();
    const number = document.getElementById('studentNumber').value.trim();
    const className = document.getElementById('studentClass').value;
    const subject = document.getElementById('studentSubject').value;
    const token = document.getElementById('studentToken').value.trim().toUpperCase();

    let hasError = false;
    const nameError = document.getElementById('nameError');
    const numberError = document.getElementById('numberError');
    const tokenError = document.getElementById('tokenError');

    nameError.classList.add('hidden');
    numberError.classList.add('hidden');
    tokenError.classList.add('hidden');

    if (!name) {
        nameError.textContent = 'Nama harus diisi';
        nameError.classList.remove('hidden');
        hasError = true;
    }

    if (!number || isNaN(number)) {
        numberError.textContent = 'Nomor siswa harus berupa angka';
        numberError.classList.remove('hidden');
        hasError = true;
    }

    if (!className) {
        showMessage('Pilih kelas', 'error');
        hasError = true;
    }

    if (!subject) {
        showMessage('Pilih mata pelajaran', 'error');
        hasError = true;
    }

    if (!token) {
        tokenError.textContent = 'Token harus diisi';
        tokenError.classList.remove('hidden');
        hasError = true;
    }

    if (token && token !== currentToken) {
        tokenError.textContent = 'Token tidak valid atau sudah kadaluarsa';
        tokenError.classList.remove('hidden');
        hasError = true;
    }

    if (hasError) return;

    sessionData = {
        name,
        number,
        className,
        subject,
        sessionId: generateSessionId()
    };

    showPreExamScreen();
}

function handleAdminLogin() {
    const password = document.getElementById('adminPassword').value;
    const adminError = document.getElementById('adminError');

    adminError.classList.add('hidden');

    if (password !== ADMIN_PASSWORD) {
        adminError.textContent = 'Password salah';
        adminError.classList.remove('hidden');
        return;
    }

    showAdminDashboard();
}

function clearErrors() {
    document.querySelectorAll('[id$="Error"]').forEach(el => {
        el.classList.add('hidden');
        el.textContent = '';
    });
}

function showMessage(message, type = 'info') {
    const messageEl = document.getElementById('loginMessage');
    messageEl.textContent = message;
    messageEl.className = `mt-4 p-3 rounded-lg ${
        type === 'error' ? 'bg-red-900 text-red-200' :
        type === 'success' ? 'bg-green-900 text-green-200' :
        'bg-blue-900 text-blue-200'
    }`;
    messageEl.classList.remove('hidden');
    setTimeout(() => messageEl.classList.add('hidden'), 5000);
}

function showErrorMessage(message) {
    showMessage(message, 'error');
}

function showInlineWarning(message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-amber-900 rounded-xl p-8 max-w-md text-center shadow-2xl">
            <i data-lucide="alert-triangle" class="w-12 h-12 text-amber-400 mx-auto mb-4"></i>
            <h2 class="text-xl font-bold text-white mb-4">${message}</h2>
            <div class="flex gap-4 justify-center">
                <button class="px-6 py-2 rounded-lg bg-gray-700 text-white font-semibold hover:bg-gray-800 transition" id="cancelBtn">
                    Batal
                </button>
                <button class="px-6 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 transition" id="confirmBtn">
                    Lanjutkan
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    lucide.createIcons();

    modal.querySelector('#confirmBtn').addEventListener('click', () => {
        modal.remove();
        if (onConfirm) onConfirm();
    });

    modal.querySelector('#cancelBtn').addEventListener('click', () => {
        modal.remove();
        if (onCancel) onCancel();
    });
}

function showPreExamScreen() {
    currentState = 'preExam';
    document.getElementById('preExamQuestionCount').textContent = questions.length || getQuestionsForSubject(sessionData.subject).length;

    loginScreen.classList.add('hidden');
    preExamScreen.classList.remove('hidden');
}

// ─── Exam Handlers ────────────────────────────────────────────────────────────

function setupExamHandlers() {
    const exitBtn = document.getElementById('exitBtn');
    const prevBtn = document.getElementById('prevBtn');
    const doubtBtn = document.getElementById('doubtBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');
    const newExamBtn = document.getElementById('newExamBtn');

    exitBtn.addEventListener('click', () => {
        showInlineWarning('Apakah Anda yakin ingin keluar dari ujian? Jawaban Anda akan hilang.', () => {
            endExam();
        });
    });

    prevBtn.addEventListener('click', () => {
        if (currentQuestion > 0) {
            currentQuestion--;
            renderQuestion();
        }
    });

    doubtBtn.addEventListener('click', () => {
        const doubts = JSON.parse(localStorage.getItem(`doubts_${sessionData.number}`) || '[]');
        if (!doubts.includes(currentQuestion)) {
            doubts.push(currentQuestion);
            localStorage.setItem(`doubts_${sessionData.number}`, JSON.stringify(doubts));
            showToast('Soal ditandai sebagai ragu-ragu');
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentQuestion < questions.length - 1) {
            currentQuestion++;
            renderQuestion();
        }
    });

    submitBtn.addEventListener('click', submitExam);
    newExamBtn.addEventListener('click', () => {
        currentState = 'login';
        loginScreen.classList.remove('hidden');
        resultScreen.classList.add('hidden');
        document.getElementById('studentLoginForm').reset();
        document.getElementById('adminLoginForm').reset();
    });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast fixed bottom-4 left-4 right-4 bg-green-500 text-white px-4 py-3 rounded-lg text-sm z-50';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function renderQuestionNav() {
    const nav = document.getElementById('questionNav');
    nav.innerHTML = '';

    questions.forEach((_, index) => {
        const div = document.createElement('div');
        div.className = 'nav-number';
        div.textContent = index + 1;
        div.id = `nav-${index}`;

        if (userAnswers[index] !== undefined) {
            div.classList.add('answered');
        }
        if (index === currentQuestion) {
            div.classList.add('current');
        }

        div.addEventListener('click', () => {
            currentQuestion = index;
            renderQuestion();
        });

        nav.appendChild(div);
    });
}

function renderQuestion() {
    lastActivityTime = Date.now();
    const question = questions[currentQuestion];
    const content = document.getElementById('questionContent');

    let optionsHTML = '';

    if (question.type === 'multiple-choice-simple') {
        optionsHTML = question.options.map((option, idx) => {
            const isChecked = userAnswers[currentQuestion] === idx;
            return `
            <label class="option-label flex items-center p-4 mb-3 rounded-lg border-2 transition" id="option-${idx}" style="border-color: ${isChecked ? '#3b82f6' : '#475569'}; background-color: ${isChecked ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)'}; cursor: pointer;">
                <input type="radio" name="answer" value="${idx}" ${isChecked ? 'checked' : ''} class="w-5 h-5 accent-blue-500" style="cursor: pointer;">
                <span class="option-text text-white flex-1">${String.fromCharCode(65 + idx)}. ${option}</span>
            </label>
        `;
        }).join('');
    } else if (question.type === 'multiple-choice-complex') {
        optionsHTML = question.options.map((option, idx) => {
            const isChecked = userAnswers[currentQuestion]?.includes(idx);
            return `
            <label class="option-label flex items-center p-4 mb-3 rounded-lg border-2 transition" id="option-${idx}" style="border-color: ${isChecked ? '#8b5cf6' : '#475569'}; background-color: ${isChecked ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)'}; cursor: pointer;">
                <input type="checkbox" value="${idx}" ${isChecked ? 'checked' : ''} class="w-5 h-5 accent-purple-500" style="cursor: pointer;">
                <span class="option-text text-white flex-1">${String.fromCharCode(65 + idx)}. ${option}</span>
            </label>
        `;
        }).join('');
    }

    content.innerHTML = `
        <div class="question-card bg-slate-800 rounded-xl p-6 mb-8">
            <div class="mb-6">
                <h3 class="question-number text-base font-bold text-blue-400 mb-3">Soal ${currentQuestion + 1} dari ${questions.length}</h3>
                ${question.stimulus ? `<div class="text-gray-300 mb-4 p-4 bg-slate-700 rounded-lg text-sm leading-relaxed">${question.stimulus}</div>` : ''}
                <p class="question-text text-base text-white font-semibold mb-6 leading-relaxed">${question.question}</p>
            </div>
            <div class="space-y-3">
                ${optionsHTML}
            </div>
        </div>
    `;

    updateQuestionNav();
    updateButtons();

    const radioButtons = content.querySelectorAll('input[type="radio"]');
    const checkboxes = content.querySelectorAll('input[type="checkbox"]');

    radioButtons.forEach(radio => {
        radio.addEventListener('change', (e) => {
            lastActivityTime = Date.now();
            userAnswers[currentQuestion] = parseInt(e.target.value);
            localStorage.setItem(`answers_${sessionData.number}`, JSON.stringify(userAnswers));
            updateQuestionNav();
            updateOptionStyles();
        });
    });

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            lastActivityTime = Date.now();
            const selected = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value));
            userAnswers[currentQuestion] = selected.length > 0 ? selected : undefined;
            localStorage.setItem(`answers_${sessionData.number}`, JSON.stringify(userAnswers));
            updateQuestionNav();
            updateOptionStyles();
        });
    });

    lucide.createIcons();
}

function updateOptionStyles() {
    const question = questions[currentQuestion];
    question.options.forEach((_, idx) => {
        const optionEl = document.getElementById(`option-${idx}`);
        if (!optionEl) return;

        let isChecked = false;
        if (question.type === 'multiple-choice-simple') {
            isChecked = userAnswers[currentQuestion] === idx;
        } else if (question.type === 'multiple-choice-complex') {
            isChecked = userAnswers[currentQuestion]?.includes(idx);
        }

        if (isChecked) {
            const color = question.type === 'multiple-choice-simple' ? '#3b82f6' : '#8b5cf6';
            const bgColor = question.type === 'multiple-choice-simple' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(139, 92, 246, 0.25)';
            optionEl.style.borderColor = color;
            optionEl.style.backgroundColor = bgColor;
        } else {
            optionEl.style.borderColor = '#475569';
            optionEl.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        }
    });
}

function updateQuestionNav() {
    questions.forEach((_, index) => {
        const nav = document.getElementById(`nav-${index}`);
        nav.classList.remove('current', 'answered');

        if (index === currentQuestion) {
            nav.classList.add('current');
        }
        if (userAnswers[index] !== undefined) {
            nav.classList.add('answered');
        }
    });
}

function updateButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    prevBtn.disabled = currentQuestion === 0;
    nextBtn.disabled = currentQuestion === questions.length - 1;

    prevBtn.style.opacity = currentQuestion === 0 ? '0.5' : '1';
    nextBtn.style.opacity = currentQuestion === questions.length - 1 ? '0.5' : '1';
}

function startTimer() {
    const duration = 90 * 60 * 1000;
    let timeRemaining = duration;

    timerInterval = setInterval(() => {
        timeRemaining -= 1000;

        const minutes = Math.floor(timeRemaining / 60000);
        const seconds = Math.floor((timeRemaining % 60000) / 1000);

        document.getElementById('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (minutes < 5) {
            document.getElementById('timer').classList.add('timer-warning');
            document.getElementById('timer').style.color = '#ef4444';
        }

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            submitExam(true);
        }
    }, 1000);
}

// ─── Anti-Cheat System ────────────────────────────────────────────────────────

function setupAntiCheat() {
    lastActivityTime = Date.now();
    violationCount = 0;

    document.addEventListener('visibilitychange', handleVisibilityChange, true);

    window.addEventListener('blur', handleWindowBlur, true);
    window.addEventListener('focus', handleWindowFocus, true);

    document.addEventListener('keydown', recordActivity, true);
    document.addEventListener('mousedown', recordActivity, true);
    document.addEventListener('touchstart', recordActivity, true);

    window.addEventListener('pagehide', () => {
        if (currentState === 'exam' && !antiCheatWarningActive) {
            triggerAntiCheatWarning('app_switch');
        }
    }, true);

    antiCheatCheckInterval = setInterval(() => {
        if (currentState === 'exam' && !antiCheatWarningActive) {
            const focusLossTime = Date.now() - lastActivityTime;
            const threshold = ANTI_CHEAT_CONFIG.isMobile
                ? ANTI_CHEAT_CONFIG.mobileTolerance
                : ANTI_CHEAT_CONFIG.warningDelayMs;

            if ((document.hidden || !document.hasFocus?.()) && focusLossTime > threshold) {
                triggerAntiCheatWarning('focus_loss');
            }
        }
    }, ANTI_CHEAT_CONFIG.checkIntervalMs);
}

function recordActivity() {
    if (currentState === 'exam' && antiCheatWarningActive) {
        cancelAntiCheatWarning();
    }
    lastActivityTime = Date.now();
}

function handleVisibilityChange() {
    if (currentState === 'exam') {
        if (document.hidden) {
            const immediateCheck = () => {
                if (document.hidden && currentState === 'exam' && !antiCheatWarningActive) {
                    triggerAntiCheatWarning('hidden_tab');
                }
            };

            const delay = ANTI_CHEAT_CONFIG.isMobile ? 500 : 300;
            setTimeout(immediateCheck, delay);
        } else if (antiCheatWarningActive) {
            cancelAntiCheatWarning();
        }
    }
}

function handleWindowBlur() {
    if (currentState === 'exam' && !ANTI_CHEAT_CONFIG.isMobile) {
        triggerAntiCheatWarning('window_blur');
    }
}

function handleWindowFocus() {
    if (antiCheatWarningActive && currentState === 'exam') {
        lastActivityTime = Date.now();
    }
}

function triggerAntiCheatWarning(reason) {
    if (antiCheatWarningActive) return;

    violationCount++;
    lastViolationTime = Date.now();
    antiCheatWarningActive = true;

    const warning = document.getElementById('antiCheatWarning');
    const warningTimer = document.getElementById('warningTimer');
    const violationNumber = document.getElementById('violationNumber');
    const warningReason = document.getElementById('warningReason');

    violationNumber.textContent = violationCount + '/2';

    const reasonTexts = {
        'focus_loss': 'Alih fokus terdeteksi',
        'hidden_tab': 'Tab tidak aktif',
        'window_blur': 'Browser kehilangan fokus',
        'app_switch': 'Aplikasi ditutup/diinimalisir'
    };

    warningReason.textContent = reasonTexts[reason] || 'Aktivitas mencurigakan';

    warning.classList.remove('hidden');
    let countdown = 10;

    warningTimer.textContent = countdown;

    antiCheatWarningTimer = setInterval(() => {
        countdown--;
        warningTimer.textContent = countdown;

        if (countdown <= 0) {
            clearInterval(antiCheatWarningTimer);
            warning.classList.add('hidden');

            if (violationCount >= 2) {
                showAutoLogoutModal('Anda melanggar peraturan anti-cheat. Ujian dihentikan.');
            } else {
                cancelAntiCheatWarning();
            }
        }
    }, 1000);
}

function cancelAntiCheatWarning() {
    antiCheatWarningActive = false;
    if (antiCheatWarningTimer) {
        clearInterval(antiCheatWarningTimer);
    }
    document.getElementById('antiCheatWarning').classList.add('hidden');
    lastActivityTime = Date.now();
}

function showAutoLogoutModal(message) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-red-950 rounded-xl p-8 max-w-md text-center shadow-2xl border-2 border-red-700">
            <i data-lucide="shield-off" class="w-16 h-16 text-red-400 mx-auto mb-4"></i>
            <h2 class="text-2xl font-bold text-white mb-4">Ujian Dihentikan</h2>
            <p class="text-red-200 mb-6 text-sm leading-relaxed">${message}</p>
            <div class="bg-red-900 bg-opacity-50 rounded-lg p-4 mb-6">
                <p class="text-red-300 text-xs"><i data-lucide="info" class="w-3 h-3 inline mr-2"></i>Hubungi guru untuk informasi lebih lanjut</p>
            </div>
            <button class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition" style="cursor: pointer; border: none;">
                Kembali ke Login
            </button>
        </div>
    `;

    document.body.appendChild(modal);
    lucide.createIcons();

    const confirmBtn = modal.querySelector('button');
    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.remove();
        endExam();
    });
}

// ─── Exam Submission ──────────────────────────────────────────────────────────

function submitExam(isAutoSubmit = false) {
    const unansweredCount = questions.length - Object.keys(userAnswers).length;

    if (unansweredCount > 0 && !isAutoSubmit) {
        showInlineWarning(`${unansweredCount} soal belum dijawab. Apakah Anda yakin ingin kumpulkan?`, () => {
            proceedWithSubmit();
        });
        return;
    }

    proceedWithSubmit();
}

function proceedWithSubmit() {
    let correctCount = 0;
    const analysis = [];

    questions.forEach((question, index) => {
        const answer = userAnswers[index];
        let isCorrect = false;

        if (question.type === 'multiple-choice-simple') {
            isCorrect = answer === question.correctAnswer;
        } else if (question.type === 'multiple-choice-complex') {
            isCorrect = JSON.stringify(answer?.sort((a, b) => a - b)) === JSON.stringify(question.correctAnswer.sort((a, b) => a - b));
        }

        if (isCorrect) {
            correctCount++;
            analysis.push({ number: index + 1, status: 'benar' });
        } else {
            analysis.push({ number: index + 1, status: 'salah' });
        }
    });

    const score = Math.round((correctCount / questions.length) * 100);

    const submission = {
        student_name: sessionData.name,
        student_number: sessionData.number,
        class: sessionData.className,
        subject: sessionData.subject,
        score: score,
        submitted_at: new Date().toISOString()
    };

    if (dataSdkReady) {
        window.dataSdk.create({
            student_name: submission.student_name,
            student_number: submission.student_number,
            class: submission.class,
            subject: submission.subject,
            score: submission.score,
            submitted_at: submission.submitted_at
        }).catch(err => console.error('Data SDK error:', err));
    }

    submitToGoogleSheet(submission);

    localStorage.removeItem(`answers_${sessionData.number}`);
    sessionStorage.removeItem(`shuffled_${sessionData.number}`);

    showResults(score, analysis);

    clearInterval(timerInterval);
    clearInterval(antiCheatCheckInterval);
}

function submitToGoogleSheet(data) {
    fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        body: JSON.stringify(data),
        mode: 'no-cors'
    }).catch(() => {
        // Silent catch for CORS issues
    });
}

function showResults(score, analysis) {
    currentState = 'result';
    document.getElementById('examScreen').classList.add('hidden');
    document.getElementById('resultScreen').classList.remove('hidden');

    document.getElementById('resultName').textContent = sessionData.name;
    document.getElementById('resultClass').textContent = sessionData.className;
    document.getElementById('resultSubject').textContent = sessionData.subject;
    document.getElementById('resultScore').textContent = score;

    const analysisHTML = analysis.map(item => `
        <div class="flex justify-between p-2 rounded ${item.status === 'benar' ? 'bg-green-500 bg-opacity-20 text-green-300' : 'bg-red-500 bg-opacity-20 text-red-300'}">
            <span>Soal ${item.number}</span>
            <span class="font-semibold">${item.status === 'benar' ? '✓ Benar' : '✗ Salah'}</span>
        </div>
    `).join('');

    document.getElementById('resultAnalysis').innerHTML = analysisHTML;

    lucide.createIcons();
}

function endExam() {
    currentState = 'login';
    clearInterval(timerInterval);
    clearInterval(antiCheatCheckInterval);

    if (antiCheatWarningTimer) {
        clearInterval(antiCheatWarningTimer);
    }

    document.removeEventListener('visibilitychange', handleVisibilityChange, true);
    window.removeEventListener('blur', handleWindowBlur, true);
    window.removeEventListener('focus', handleWindowFocus, true);
    document.removeEventListener('keydown', recordActivity, true);
    document.removeEventListener('mousedown', recordActivity, true);
    document.removeEventListener('touchstart', recordActivity, true);

    loginScreen.classList.remove('hidden');
    examScreen.classList.add('hidden');
    preExamScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    document.getElementById('antiCheatWarning').classList.add('hidden');

    cancelAntiCheatWarning();
}

// ─── Admin Panel Handlers ─────────────────────────────────────────────────────

function setupAdminHandlers() {
    const logoutAdminBtn = document.getElementById('logoutAdminBtn');
    const tabToken = document.getElementById('tabToken');
    const tabQuestions = document.getElementById('tabQuestions');
    const tabAnalysis = document.getElementById('tabAnalysis');

    logoutAdminBtn.addEventListener('click', () => {
        currentState = 'login';
        loginScreen.classList.remove('hidden');
        adminScreen.classList.add('hidden');
    });

    tabToken.addEventListener('click', () => switchAdminTab('token'));
    tabQuestions.addEventListener('click', () => switchAdminTab('questions'));
    tabAnalysis.addEventListener('click', () => switchAdminTab('analysis'));

    document.getElementById('subjectFilter').addEventListener('change', () => {
        renderQuestionsPreview();
    });

    document.getElementById('classFilter').addEventListener('change', () => {
        renderAnalysis();
    });
    document.getElementById('analysisSubjectFilter').addEventListener('change', () => {
        renderAnalysis();
    });
    document.getElementById('sortFilter').addEventListener('change', () => {
        renderAnalysis();
    });
}

function showAdminDashboard() {
    currentState = 'admin';
    loginScreen.classList.add('hidden');
    adminScreen.classList.remove('hidden');
    resultScreen.classList.add('hidden');

    switchAdminTab('token');
    updateTokenDisplay();
}

function switchAdminTab(tab) {
    const tabs = ['token', 'questions', 'analysis'];

    tabs.forEach(t => {
        document.getElementById(`${t}Content`).classList.add('hidden');
        document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`).style.borderColor = 'transparent';
        document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`).style.backgroundColor = 'transparent';
    });

    document.getElementById(`${tab}Content`).classList.remove('hidden');
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.borderColor = '#3b82f6';
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.backgroundColor = 'rgba(59, 130, 246, 0.1)';

    if (tab === 'questions') {
        renderQuestionsPreview();
    } else if (tab === 'analysis') {
        initializeAnalysisHandler();
    }
}

function updateTokenDisplay() {
    document.getElementById('currentToken').textContent = currentToken;

    const nextRefresh = new Date(tokenLastRefresh + TOKEN_REFRESH_INTERVAL);
    const now = new Date();
    const timeRemaining = Math.max(0, Math.floor((nextRefresh - now) / 1000));

    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    document.getElementById('tokenRefreshTime').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startTokenRefresh() {
    setInterval(() => {
        if (currentState === 'admin') {
            updateTokenDisplay();
        }
    }, 1000);

    tokenRefreshInterval = setInterval(() => {
        currentToken = generateToken();
        tokenLastRefresh = Date.now();
        updateTokenDisplay();
    }, TOKEN_REFRESH_INTERVAL);
}

function renderQuestionsPreview() {
    const filter = document.getElementById('subjectFilter').value;
    const filtered = questions.filter(q => !filter || q.subject === filter);

    const ipaCount = questions.filter(q => q.subject === 'IPA').length;
    const informaticsCount = questions.filter(q => q.subject === 'Informatika').length;

    document.getElementById('ipaCount').textContent = ipaCount;
    document.getElementById('informaticsCount').textContent = informaticsCount;

    if (filtered.length === 0) {
        document.getElementById('questionsList').innerHTML = '<p class="text-gray-400 text-center py-8">Tidak ada soal</p>';
        return;
    }

    const html = filtered.map((q, idx) => `
        <div class="glassmorphism rounded-lg p-6">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h4 class="text-lg font-bold text-white">Soal ${idx + 1}</h4>
                    <p class="text-sm text-gray-400">${q.subject} • ${q.type === 'multiple-choice-simple' ? 'Pilihan Ganda' : 'Pilihan Ganda Kompleks'}</p>
                </div>
                <span class="text-xs font-mono text-blue-400 bg-blue-900 bg-opacity-50 px-3 py-1 rounded">Kunci: ${String.fromCharCode(65 + (Array.isArray(q.correctAnswer) ? q.correctAnswer[0] : q.correctAnswer))}</span>
            </div>
            ${q.stimulus ? `<div class="bg-slate-800 p-3 rounded mb-4 text-gray-300 text-sm line-clamp-2">${q.stimulus.substring(0, 200)}...</div>` : ''}
            <p class="text-white mb-4 font-semibold line-clamp-2">${q.question}</p>
            <div class="space-y-2">
                ${q.options.slice(0, 3).map((opt, i) => `
                    <p class="text-gray-300 text-sm line-clamp-1">
                        <span class="font-semibold text-blue-400">${String.fromCharCode(65 + i)}.</span> ${opt}
                    </p>
                `).join('')}
            </div>
        </div>
    `).join('');

    document.getElementById('questionsList').innerHTML = html;
    lucide.createIcons();
}

let allAnalysisData = [];

async function initializeAnalysisHandler() {
    renderAnalysis();
}

function renderAnalysis() {
    const classFilter = document.getElementById('classFilter').value;
    const subjectFilter = document.getElementById('analysisSubjectFilter').value;
    const sortFilter = document.getElementById('sortFilter').value;

    const analysisList = document.getElementById('analysisList');

    if (!dataSdkReady || !allAnalysisData || allAnalysisData.length === 0) {
        analysisList.innerHTML = '<p class="text-gray-400 text-center py-8">Belum ada data jawaban siswa</p>';
        return;
    }

    let filtered = allAnalysisData.filter(item => {
        let match = true;
        if (classFilter && item.class !== classFilter) match = false;
        if (subjectFilter && item.subject !== subjectFilter) match = false;
        return match;
    });

    if (sortFilter === 'name') {
        filtered.sort((a, b) => a.student_name.localeCompare(b.student_name));
    } else if (sortFilter === 'score-desc') {
        filtered.sort((a, b) => b.score - a.score);
    } else if (sortFilter === 'score-asc') {
        filtered.sort((a, b) => a.score - b.score);
    }

    if (filtered.length === 0) {
        analysisList.innerHTML = '<p class="text-gray-400 text-center py-8">Tidak ada data sesuai filter</p>';
        return;
    }

    const html = filtered.map(item => {
        let scoreColor, statusText, statusBg;

        if (item.score >= 70) {
            scoreColor = 'text-green-400';
            statusText = '✓ Tuntas';
            statusBg = 'bg-green-500 bg-opacity-20 text-green-300';
        } else if (item.score >= 60) {
            scoreColor = 'text-yellow-400';
            statusText = '⚠ Belum Tuntas';
            statusBg = 'bg-yellow-500 bg-opacity-20 text-yellow-300';
        } else {
            scoreColor = 'text-red-400';
            statusText = '✗ Belum Tuntas';
            statusBg = 'bg-red-500 bg-opacity-20 text-red-300';
        }

        return `
            <div class="glassmorphism rounded-lg p-6">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1">
                        <h4 class="text-lg font-bold text-white">${item.student_name}</h4>
                        <div class="flex gap-4 text-sm text-gray-400 mt-2">
                            <span><i data-lucide="user" class="w-4 h-4 inline mr-1"></i>No: ${item.student_number}</span>
                            <span><i data-lucide="users" class="w-4 h-4 inline mr-1"></i>Kelas: ${item.class}</span>
                            <span><i data-lucide="book" class="w-4 h-4 inline mr-1"></i>${item.subject}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-3xl font-bold ${scoreColor}">${item.score}</p>
                        <p class="text-xs ${statusBg} px-3 py-1 rounded mt-2 font-semibold inline-block">
                            ${statusText}
                        </p>
                    </div>
                </div>
                <div class="border-t border-slate-700 pt-3">
                    <p class="text-xs text-gray-500">
                        Submitted: ${new Date(item.submitted_at).toLocaleString('id-ID')}
                    </p>
                </div>
            </div>
        `;
    }).join('');

    analysisList.innerHTML = html;
    lucide.createIcons();
}

// ─── Utility Functions ────────────────────────────────────────────────────────

function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 4; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

function generateSessionId() {
    return 'SESSION_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function shuffleOptionsOnly(questions) {
    return questions.map(question => {
        const tempIndices = question.options.map((_, idx) => idx);

        for (let i = tempIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tempIndices[i], tempIndices[j]] = [tempIndices[j], tempIndices[i]];
        }

        const shuffledOptions = tempIndices.map(idx => question.options[idx]);

        let newCorrectAnswer;
        if (Array.isArray(question.correctAnswer)) {
            newCorrectAnswer = question.correctAnswer.map(correctIdx => tempIndices.indexOf(correctIdx));
        } else {
            newCorrectAnswer = tempIndices.indexOf(question.correctAnswer);
        }

        return {
            ...question,
            options: shuffledOptions,
            correctAnswer: newCorrectAnswer,
            originalIndices: tempIndices
        };
    });
}

// ─── Question Bank ────────────────────────────────────────────────────────────

function getQuestionsForSubject(subject) {
    const allQuestions = [
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Rendy menggosok-gosok kedua tangannya lalu ditempel ke pipinya. Dia merasakan hangat pada telapak tangannya.',
            question: 'Suatu sensasi atau ukuran derajat dingin maupun panasnya suatu benda disebut dengan ….',
            options: ['Derajat', 'Suhu', 'Kehangatan', 'Arus Panas'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/1GLZSZv2/Mobil-tol.png" alt="Mobil tol" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar mobil tol\';"/> Mobil Alphard dan mobil Pajero sedang melaju di jalan tol sejauh 36 kilometer. Apabila mobil Alphard menempuh jarak tersebut dengan waktu 20 menit dan Pajero dengan waktu 25 menit.',
            question: 'Maka pernyataan yang tepat adalah ….',
            options: ['Percepatan Alphard = Percepatan Pajero', 'Percepatan Alphard > Percepatan Pajero', 'Percepatan Alphard < Percepatan Pajero', 'Keduanya sama sama menempuh waktu yang sama'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/xqpsKQSg/Tarik-tambang-juga.png" alt="Tarik-tambang-juga" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar tarik tambang\';"/> Dua tim sedang lomba tarik tambang. Kedua tim masing-masing memiliki 5 orang penarik dengan gaya yang berbeda-beda pada gambar. Apabila keadaannya tim kiri menarik lebih besar dari tim kanan, maka tim kanan harus lebih besar gaya tarikannya agar menang.',
            question: 'Gaya tarikan yang diperlukan berturut-turut pada gambar orang tersebut adalah ….',
            options: ['150 Newton & 200 Newton', '100 Newton & 300 Newton', '200 Newton & 50 Newton', '200 Newton & 100 Newton'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/LhtwSLFS/pickup-dorong.png" alt="pickup-dorong" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar pickup didorong\';"/> Mobil pickup sedang mogok lalu didorong oleh 3 orang dengan masing-masing gaya 175 Newton. Apabila mobil tersebut memiliki gaya minimal sebesar 1050 Newton agar terdorong,',
            question: 'maka orang yang diperlukan lagi untuk mencapai gaya minimal adalah .....',
            options: ['Tidak perlu menambah orang', '1 Orang', '2 Orang', '3 Orang'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/NdxYF6sP/pickup-merah.png" alt="pickup merah" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar pickup merah\';"/> Pickup merah membawa 6 kotak berisi barang dagangan dengan masing-masing kotak bermassa 20 kilogram. Apabila massa mobil sebesar 1480 kilogram dan mobil tersebut melaju dengan percepatan 2,5 m/s<sup>2</sup>',
            question: 'maka gaya dorong mobil pickup tersebut adalah ……',
            options: ['2500 Newton', '3000 Newton', '4000 Newton', '4500 Newton'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/Txq7qrKz/hilux.png" alt="hilux" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar hilux\';"/> Jika barang-barang tersebut memiliki massa 200 kilogram dan massa Hilux sebesar 1000 kilogram. Apabila Hilux memiliki gaya dorong sebesar 3600 Newton,',
            question: 'percepatan (a) oleh Hilux tersebut ketika berjalan adalah ….',
            options: ['2 m/s<sup>2</sup>', '3 m/s<sup>2</sup>', '1 m/s<sup>2</sup>', '4 m/s<sup>2</sup>'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar berikut! <img src="https://i.ibb.co.com/kNQcFqk/mobil-tabrak.png" alt="mobil tabrak" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar mobil tabrak\';"/> Apabila mobil kiri memiliki massa 1000 kilogram dengan percepatan 2,5 m/s<sup>2</sup> sedangkan mobil kanan memiliki massa 900 kilogram dengan percepatan 3 m/s<sup>2</sup>.',
            question: 'Masing-masing gaya pada mobil kiri dan kanan secara berturut-turut dan mobil yang lebih rusak adalah ……',
            options: ['2500 N & 2700 N, mobil kanan lebih rusak', '2500 N & 2700 N, mobil kiri lebih rusak', '2000 N & 2500 N, mobil kanan lebih rusak', '2000 N & 2500 N, mobil kiri lebih rusak'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Naufal sedang mencoba mendayung perahu di sebuah danau. Agar perahu dapat bergerak maju ke depan, Roni harus mengayuh dayungnya ke arah belakang menembus air.',
            question: 'Konsep Hukum III Newton yang menjelaskan peristiwa ini adalah...',
            options: ['Air menahan dayung ke depan (Aksi), dan dayung mendorong perahu ke belakang (Reaksi).', 'Roni mendorong dayung ke belakang (Aksi), dan perahu bergerak ke depan karena kehilangan massa (Reaksi).', 'Gaya aksi dari dayung selalu lebih besar daripada gaya reaksi dari air sehingga perahu bisa melaju.', 'Dayung mendorong air ke belakang (Aksi), dan air mendorong dayung ke depan (Reaksi) sehingga perahu maju.'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Setelah melakukan penilaian lari sebanyak 2 putaran di sekolah, tubuh Hasan mengeluarkan banyak sekali keringat dan nafasnya menjadi sangat cepat.',
            question: 'Peristiwa keluarnya keringat dari tubuh Hasan merupakan bukti bahwa makhluk hidup memiliki ciri...',
            options: ['Memerlukan nutrisi', 'Tumbuh dan berkembang', 'Menanggapi rangsangan', 'Mengeluarkan zat sisa (ekskresi)'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Khansa dan Natasya ketika berjalan keluar dari bioskop yang gelap menuju area parkir yang disinari matahari terik maka secara otomatis kelopak mata mereka berdua langsung mengernyit dan pupil mata mengecil.',
            question: 'Gejala tersebut merupakan salah satu ciri makhluk hidup yaitu …..',
            options: ['Peka terhadap rangsangan (iritabilitas)', 'Mengalami pertumbuhan dan perkembangan', 'Memerlukan energi', 'Bernafas'],
            correctAnswer: 0
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Seorang murid melakukan eksperimen dengan meletakkan sebuah pot tanaman di dalam kotak kardus tertutup yang diberi satu lubang kecil di sisi kanan. Setelah satu minggu, batang tanaman tersebut tumbuh membelok ke arah lubang.',
            question: 'Ciri makhluk hidup yang paling tepat ditunjukkan oleh tanaman tersebut beserta alasannya adalah...',
            options: ['Bergerak pasif, karena tanaman tidak berpindah tempat melainkan hanya batangnya yang memanjang.', 'Tumbuh dan berkembang, karena tanaman mengalami pertambahan tinggi batang yang signifikan.', 'Peka terhadap rangsang (iritabilitas), karena tanaman merespons arah datangnya cahaya matahari melalui lubang tersebut.', 'Memerlukan nutrisi, karena tanaman membutuhkan cahaya untuk melakukan proses fotosintesis.'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Suatu alat untuk mengukur derajat dingin atau panasnya suatu benda disebut dengan…',
            options: ['Telapak Tangan', 'Hidrometer', 'Termometer', 'Meteran'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Lana menyadari bahwa es batu yang sedang dia pegang sangat dingin sehingga tangannya mulai memerah. Tapi dia sebenarnya tidak bisa mengetahui berapa derajat suhunya.',
            question: 'Mengapa tangan tidak dapat digunakan sebagai alat pengukur suhu yang tepat?',
            options: ['Tangan hanya bisa merasakan suhu yang panas dan suhu yang dingin', 'Tangan tidak memiliki saraf peraba yang peka terhadap suhu', 'Suhu tangan selalu berubah-ubah sesuai keadaan di sekitar', 'Pengukuran pada tangan bersifat subyektif dan tidak punya skala tetap'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Suhu memiliki Satuan Internasional (SI) untuk setiap pengukurannya. Satuan tersebut ialah …...',
            options: ['Kelvin', 'Celcius', 'Reamur', 'Fahrenheit'],
            correctAnswer: 0
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Keanu menggunakan termometer untuk mengukur suhunya karena lagi demam. Termometer menunjukkan hasil 37°C di layar.',
            question: 'Apabila diubah menjadi skala Kelvin maka hasilnya adalah …..',
            options: ['280 K', '290 K', '300 K', '310 K'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Indra sedang tinggal di Amerika Serikat. Suhu tubuhnya ketika dia cek terakhir menggunakan termometer yang dia bawa ke Amerika menunjukkan 35°C.',
            question: 'Amerika Serikat menggunakan skala Fahrenheit untuk pengukuran suhunya. Suhu Indra sekarang adalah ….',
            options: ['91°F', '93°F', '95°F', '97°F'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Seorang teknisi memasang kabel listrik pada siang hari yang sangat terik. <img src="https://i.ibb.co.com/67J35PJy/listrik.jpg" alt="Teknisi memasang kabel listrik" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar teknisi memasang kabel\';"/>',
            question: 'Mengapa teknisi tersebut harus memasang kabel dengan keadaan yang agak kendur dan tidak tegang?',
            options: ['Untuk menghemat menggunakan kabel listrik', 'Kaca seringkali menyusut ketika siang hari', 'Agar kabel memiliki ruang untuk memuai lebih panjang pada siang hari', 'Agar hambatan listrik semakin kecil'],
            correctAnswer: 2
        },
        {
            subject: 'Informatika',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Apa kepanjangan dari HTML?',
            options: ['Hyper Text Markup Language', 'High Tech Modern Language', 'Home Tool Markup Language', 'Hyper Type Markup Language'],
            correctAnswer: 0
        },
        {
            subject: 'Informatika',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Bahasa pemrograman mana yang paling sering digunakan untuk web development?',
            options: ['Python', 'JavaScript', 'C++', 'Java'],
            correctAnswer: 1
        },
        {
            subject: 'Informatika',
            type: 'multiple-choice-complex',
            stimulus: '',
            question: 'Pilih semua yang termasuk dalam konsep Object-Oriented Programming:',
            options: ['Enkapsulasi', 'Looping', 'Inheritance', 'Polimorfisme'],
            correctAnswer: [0, 2, 3]
        },
        {
            subject: 'Informatika',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Struktur data apa yang mengikuti prinsip LIFO (Last In First Out)?',
            options: ['Array', 'Queue', 'Stack', 'Linked List'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Ketika Surya memegang es batu di tangannya lalu seketika telapak tangannya menjadi dingin.',
            question: 'Fenomena tersebut dapat menyatakan bahwa ….',
            options: ['Suhu es batu dan tangan Surya adalah sama', 'Rasa dingin dari es batu berpindah menuju tangan Surya sehingga menjadi dingin', 'Panas dari tangan Surya berpindah menuju es batu sehingga tangan merasakan dingin', 'Tangan Surya telah dingin terlebih dahulu sebelumnya'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Ketika siang hari, suhu di Banjarbaru yaitu 32°C. Namun ketika malam hari suhunya menjadi 26°C.',
            question: 'Berapa selisih perubahan suhu dalam celcius?',
            options: ['6°C', '8°C', '-6°C', '-8°C'],
            correctAnswer: 0
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Pemasangan bingkai kaca pada jendela seringkali dibuat sedikit lebih lebar daripada ukuran kacanya.',
            question: 'Hal tersebut memiliki tujuan untuk ….',
            options: ['Mencegah udara dingin masuk ke ruangan', 'Kaca seringkali menyusut ketika siang hari', 'Menghindari kaca memuai pada siang hari', 'Agar kaca tidak terlepas ketika angin kencang'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perkemahan biasanya melakukan suatu kegiatan yaitu api unggun. Saat kamu duduk di dekat api unggun, wajahmu terasa panas. Padahal udara adalah isolator yang baik dan udara panas cenderung bergerak ke atas. <img src="https://i.ibb.co.com/1f8NvhC6/PHOTO-. .jpg" alt="Api unggun" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar api unggun\';"/>',
            question: 'Perpindahan panas yang kamu rasakan adalah….',
            options: ['Anomali', 'Konveksi', 'Konduksi', 'Radiasi'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Rendy menaruh daging sapi qurban dengan massa 2 kilogram yang memiliki suhu awal yaitu 20°C pada freezer di kulkasnya. Setelah beberapa jam, suhu akhir di freezer menjadi -5°C sehingga daging menjadi beku. <img src="https://i.ibb.co.com/hRKKWCPD/daging-sapi.jpg" alt="daging sapi" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar daging sapi\';"/> Apabila kalor jenis daging sapi sebesar 3500 J/Kg°C maka kalor yang diperlukan untuk membekukan daging ialah …..',
            question: 'Berapakah kalor yang diperlukan?',
            options: ['-125.000 Joule', '-150.000 Joule', '-175.000 Joule', '-200.000 Joule'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: '',
            question: 'Sebuah benda dikatakan bergerak terhadap suatu titik acuan tertentu apabila ….',
            options: ['Benda tersebut diam terhadap titik acuan tersebut', 'Benda tersebut memiliki kecepatan sama dengan 0', 'Posisi benda tersebut berubah dari titik acuan tersebut', 'Jarak benda terhadap titik acuan tetap'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Ardo sedang menaiki kereta cepat Whoosh dari Kota Bandung menuju Jakarta dengan kecepatan 350 Km/Jam. Ardo yang bergerak ke depan dari kereta melihat pepohonan bergerak mundur melalui kaca jendela.',
            question: 'Fenomena gerak tersebut dinamakan….',
            options: ['Gerak Semu', 'Gerak Relatif', 'Gerak Tak Tetap', 'Gerak Melingkar'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Wildan sedang mengukur panjang sebuah meja belajar di rumahnya menggunakan penggaris beberapa kali. Dia menjumlahkan pengukurannya sebesar 215 centimeter.',
            question: 'Dalam Satuan Internasional (SI) pada pengukuran panjang, maka panjang meja tersebut adalah ….',
            options: ['0,00215 kilometer', '2150 millimeter', '2,15 meter', '21,5 desimeter'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan gambar denah berikut! <img src="https://i.ibb.co.com/VcXW2yqc/Denah.png" alt="Denah" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar denah\';"/> Fachri bergerak menuju rumah Aditya lalu berangkat ke sekolah bersama-sama. Ketika pulang sekolah mereka ingin ke rumah Nizam untuk kerja kelompok IPA sehingga pulang pukul 17.00 WITA. Fachri melalui rute yang sama yaitu melalui sekolah-rumah Aditya lalu kembali ke rumahnya.',
            question: 'Jarak tempuh dan perpindahan Fachri berturut-turut adalah ……',
            options: ['1000 meter & 1000 meter', '1500 meter & 0 meter', '1000 meter & 0 meter', '1500 meter & 1500 meter'],
            correctAnswer: 1
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Jarak dari Landasan Ulin menuju Banjarmasin dihitung sebesar 25.000 meter. Apabila sebuah motor menempuh jarak tersebut dengan waktu sebesar 2500 sekon,',
            question: 'maka kecepatan dari motor tersebut adalah ….',
            options: ['25 m/s', '20 m/s', '15 m/s', '10 m/s'],
            correctAnswer: 3
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Perhatikan tabel berikut! <img src="https://i.ibb.co.com/WpYB2fxf/Tabel.png" alt="Tabel" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" onerror="console.error(\'Image failed to load:\', this.src); this.style.background=\'#64748b\'; this.alt=\'Gambar tabel\';"/> Di sekolah, pak Budianto sedang mengambil nilai atletik (lari) untuk siswa 7A yang nilainya berdasarkan di tabel. Apabila jarak mereka lari sebesar 100 meter.',
            question: 'Maka urutan yang paling lambat dan paling cepat adalah ….',
            options: ['4-2-1-3', '4-3-1-2', '4-1-3-2', '4-3-2-1'],
            correctAnswer: 2
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Ketika kita sedang naik mobil lalu tiba tiba melaju kencang, tubuh kita seketika terdorong ke belakang dan apabila direm secara mendadak maka tubuh akan terdorong ke depan.',
            question: 'Fenomena ini merupakan hukum kemalasan atau kelembaman yaitu …..',
            options: ['Hukum I Newton', 'Hukum II Newton', 'Hukum III Newton', 'Hukum IV Newton'],
            correctAnswer: 0
        },
        {
            subject: 'IPA',
            type: 'multiple-choice-simple',
            stimulus: 'Sebuah motor memiliki gaya dorong 2500 Newton melaju di jalanan yang lurus. Apabila percepatannya bertambah dari 1 m/s² ke 2 m/s²',
            question: 'maka keadaan gaya dorong dari motor tersebut yang paling mendekati adalah …..',
            options: ['Motor akan melambat laju dengan gaya dorong sekitar 2000 Newton', 'Motor akan tiba tiba diam', 'Motor akan tetap berjalan dengan kecepatan yang konstan', 'Motor akan lebih cepat dengan gaya dorong sekitar 3500 N'],
            correctAnswer: 3
        }
    ].filter(q => q.subject === subject);

    return allQuestions.slice(0, 40);
}
