// Configuración de Firebase (Realtime Database se usa como servidor de señalización WebRTC)
const firebaseConfig = {
  //ingresar credenciales
  apiKey: "AIzaSyDuoR2Wo7rRYgzWp5S9-JkFnm5-eGdb0Mc",
  authDomain: "webrtctest-2a35f.firebaseapp.com",
  databaseURL: "https://webrtctest-2a35f-default-rtdb.firebaseio.com",
  projectId: "webrtctest-2a35f",
  storageBucket: "webrtctest-2a35f.firebasestorage.app",
  messagingSenderId: "286452141653",
  appId: "1:286452141653:web:9f43e11856315249fe8edc"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};
