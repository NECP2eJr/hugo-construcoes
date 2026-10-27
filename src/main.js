/**
 * main.js — Ponto de entrada do site Prédio 3D em Linhas Brancas.
 *
 * Monta a cena Three.js, carrega moradores, acende quartos,
 * configura interações e animações.
 */

import * as THREE from 'three';
import './style.css';

import { BUILDING, COLORS, ANIM, PERSON, STARS, MOON } from './config.js';
import { setupCamera } from './scene/cameraSetup.js';
import { createBuilding } from './scene/building.js';
import { createStars, createMoon } from './scene/sky.js';
import { createGround, createSidewalk, createPost, createAllPosts, createTrashcan } from './scene/ground.js';
import { createPerson } from './scene/person.js';
import { parseApartment } from './data/parseApartment.js';
import { loadMoradores } from './data/loadMoradores.js';
import { Firefly } from './fx/firefly.js';
import { GuideLine } from './ui/guideLine.js';
import { isTouchDevice, watchTouchMode, setupMobileCamera, MobileZoom, MobileNameOverlay } from './mobile/mobile.js';

// ─── Renderer ──────────────────────────────────────────────────
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice() ? 1.5 : 2));
renderer.setClearColor(COLORS.background);
container.appendChild(renderer.domElement);

// ─── Cena ──────────────────────────────────────────────────────
const scene = new THREE.Scene();

// ─── Câmera ────────────────────────────────────────────────────
const { camera, controls } = setupCamera(renderer);

// ─── Prédio ────────────────────────────────────────────────────
const building = createBuilding();
scene.add(building.group);

// ─── Chão ──────────────────────────────────────────────────────
const ground = createGround();
scene.add(ground);

// ─── Calçada ───────────────────────────────────────────────────
const sidewalk = createSidewalk();
scene.add(sidewalk);

// ─── Postes (3 pares ao longo da calçada, avançados para frente) ─
const posts = createAllPosts();
posts.forEach(p => scene.add(p.group));

// ─── Lixeira ───────────────────────────────────────────────────
const trashcan = createTrashcan();
scene.add(trashcan.group);

// ─── Céu ───────────────────────────────────────────────────────
const isLite = isTouchDevice();
const stars = createStars(isLite);
scene.add(stars);

const moon = createMoon();
scene.add(moon.group);

// ─── Moradores ─────────────────────────────────────────────────
const moradores = loadMoradores();
const persons = [];

// Acender quartos com escalonamento
moradores.forEach((m, idx) => {
  const parsed = parseApartment(m.apartamento);
  if (!parsed) {
    console.warn(`[predio] Apartamento "${m.apartamento}" inválido para ${m.nome}, ignorando.`);
    return;
  }

  const key = `${parsed.floor}-${parsed.position}`;
  const apt = building.apartments.get(key);
  if (!apt) {
    console.warn(`[predio] Apartamento ${key} não encontrado para ${m.nome}.`);
    return;
  }

  // Marcar como aceso
  apt.lit = true;
  apt.color = m.corLuz;
  apt.morador = m;

  // Cor da janela e da lâmpada do quarto
  const color = new THREE.Color(m.corLuz);
  apt.glowMat.color = color;
  if (apt.lampGlowMat) {
    apt.lampGlowMat.color = color;
  }

  // Escalonamento do fade-in
  const delay = idx * ANIM.lightStagger;
  setTimeout(() => {
    apt.targetOpacity = 0.45;
    if (apt.lampGlowMat) {
      apt.lampGlowMat.opacity = 0.85;
    }

    // Pessoinha após a luz (com variedade de atividades: computador, cama ou em pé)
    setTimeout(() => {
      const phase = Math.random() * Math.PI * 2;
      const act = idx % 3 === 0 ? 'computer' : (idx % 3 === 1 ? 'bed' : 'standing');
      const person = createPerson(apt.x, parsed.floor, m.corLuz, phase, act);
      scene.add(person.group);
      person.group.userData.targetOpacity = 0.85;
      persons.push(person);
    }, PERSON.fadeInDelay);
  }, delay + ANIM.entryDuration * 0.5);
});

// ─── Vaga-lume ─────────────────────────────────────────────────
const firefly = new Firefly(container);

// ─── Linha-guia (desktop) ──────────────────────────────────────
const guideLine = new GuideLine(container);

// ─── Mobile ────────────────────────────────────────────────────
let mobileMode = isTouchDevice();
let mobileZoom = null;
const mobileNameOverlay = new MobileNameOverlay(container, () => mobileZoom?.zoomOut());

if (mobileMode) {
  setupMobileCamera(camera, controls);
}
mobileZoom = new MobileZoom(camera, building.apartments, mobileNameOverlay, controls);

watchTouchMode((isTouch) => {
  mobileMode = isTouch;
  if (isTouch && !mobileZoom.zoomed) {
    setupMobileCamera(camera, controls);
  } else if (!isTouch && !mobileZoom.zoomed) {
    controls.enabled = true;
  }
});

// ─── Raycasting ────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Coletar todos os hitboxes
const hitboxes = [];
building.apartments.forEach((apt) => {
  hitboxes.push(apt.hitbox);
});
hitboxes.push(building.doorHitbox);
posts.forEach((post) => hitboxes.push(...post.hitboxes));
hitboxes.push(trashcan.hitbox);

let hoveredApt = null;

function doRaycast(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(hitboxes);
  return intersects.length > 0 ? intersects[0] : null;
}

// ─── Eventos de mouse (desktop) ────────────────────────────────
renderer.domElement.addEventListener('mousemove', (e) => {
  if (mobileMode) return;

  const hit = doRaycast(e.clientX, e.clientY);

  if (hit && hit.object.userData.type === 'apartment') {
    const key = hit.object.userData.key;
    const apt = building.apartments.get(key);
    if (apt && apt.lit) {
      if (hoveredApt !== key) {
        hoveredApt = key;
        // Projetar centro do quarto na tela
        const pos = new THREE.Vector3(apt.x, apt.y, BUILDING.unitDepth / 2 + 0.1);
        pos.project(camera);
        const screenX = (pos.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (-pos.y * 0.5 + 0.5) * window.innerHeight;
        guideLine.show(
          { x: screenX, y: screenY },
          apt.morador.nome,
          apt.floor,
          key
        );
      }
    } else {
      if (hoveredApt) {
        guideLine.hide();
        hoveredApt = null;
      }
    }
  } else {
    if (hoveredApt) {
      guideLine.hide();
      hoveredApt = null;
    }
  }
});

renderer.domElement.addEventListener('click', (e) => {
  if (mobileMode) return; // O touchstart cuida dos toques para evitar clique duplicado.
  const hit = doRaycast(e.clientX, e.clientY);
  if (!hit) {
    if (mobileZoom?.zoomed) mobileZoom.zoomOut();
    return;
  }

  const { type } = hit.object.userData;
  if (type !== 'apartment' && mobileZoom.zoomed) mobileZoom.zoomOut();
  if (type === 'apartment') {
    const key = hit.object.userData.key;
    if (mobileZoom.zoomedKey === key) mobileZoom.zoomOut();
    else mobileZoom.zoomTo(key);
    guideLine.hide();
    hoveredApt = null;
    return;
  }

  if (type === 'post') {
    const post = hit.object.userData.post;
    if (post) {
      post.on = !post.on;
      // Animação suave feita no loop
    }
  }

  if (type === 'trashcan') {
    trashcan.targetLidAngle = trashcan.targetLidAngle > 0.1
      ? 0
      : BUILDING.doorHeight ? Math.PI * 0.6 : Math.PI * 0.6;
    clearTimeout(trashcan.autoCloseTimer);
    if (trashcan.targetLidAngle > 0) {
      trashcan.autoCloseTimer = setTimeout(() => {
        trashcan.targetLidAngle = 0;
      }, 3000);
    }
  }

  if (type === 'door') {
    // Porta abre e fecha
    if (!building.doorLines.userData.animating) {
      building.doorLines.userData.animating = true;
      building.doorLines.userData.openProgress = 0;
      building.doorLines.userData.opening = true;
    }
  }

});

// Touch events for mobile
renderer.domElement.addEventListener('touchstart', (e) => {
  if (!mobileMode) return;
  const touch = e.touches[0];

  firefly.touchPulse(touch.clientX, touch.clientY);

  const hit = doRaycast(touch.clientX, touch.clientY);
  if (hit) {
    const { type } = hit.object.userData;
    if (type !== 'apartment' && mobileZoom.zoomed) mobileZoom.zoomOut();
    if (type === 'apartment') {
      const key = hit.object.userData.key;
      if (mobileZoom.zoomedKey === key) mobileZoom.zoomOut();
      else mobileZoom.zoomTo(key);
    } else if (type === 'post') {
      const post = hit.object.userData.post;
      if (post) post.on = !post.on;
    } else if (type === 'trashcan') {
      trashcan.targetLidAngle = trashcan.targetLidAngle > 0.1 ? 0 : Math.PI * 0.6;
      clearTimeout(trashcan.autoCloseTimer);
      if (trashcan.targetLidAngle > 0) {
        trashcan.autoCloseTimer = setTimeout(() => { trashcan.targetLidAngle = 0; }, 3000);
      }
    }
  } else if (mobileZoom && mobileZoom.zoomed) {
    mobileZoom.zoomOut();
  }
}, { passive: true });

// ─── Acessibilidade: lista sr-only ─────────────────────────────
const srList = document.getElementById('sr-moradores');
if (srList) {
  moradores.forEach(m => {
    const li = document.createElement('li');
    li.textContent = `${m.nome} — Apartamento ${m.apartamento}`;
    srList.appendChild(li);
  });
}

// ─── Resize ────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (mobileMode && !mobileZoom?.zoomed) setupMobileCamera(camera, controls);
});

// ─── Loop de animação ──────────────────────────────────────────
const clock = new THREE.Clock();
let lastTime = 0;

// Respeitar prefers-reduced-motion
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Pausar quando aba está oculta
  if (dt > 0.5) return;

  // ── Controles ──
  if (!mobileMode && !mobileZoom?.zoomed) {
    controls.updateCamera(dt);
    renderer.domElement.style.opacity = controls.wrapFade ?? 1;
  }

  // ── Estrelas cintilação ──
  if (stars.material.uniforms) {
    stars.material.uniforms.uTime.value = elapsed;
  }

  // ── Lua billboard e respiração ──
  moon.group.lookAt(camera.position);
  if (!prefersReduced) {
    const breathe = Math.sin(elapsed * MOON.breatheSpeed) * MOON.breatheAmount;
    moon.moonMat.opacity = 0.85 + breathe;
    moon.haloMat.opacity = 0.6 + breathe;
  }

  // ── Quartos: fade-in da luz ──
  building.apartments.forEach((apt) => {
    if (apt.targetOpacity !== apt.currentOpacity) {
      apt.currentOpacity += (apt.targetOpacity - apt.currentOpacity) * 0.05;
      if (Math.abs(apt.targetOpacity - apt.currentOpacity) < 0.001) {
        apt.currentOpacity = apt.targetOpacity;
      }
      apt.glowMat.opacity = apt.currentOpacity;
    }

    // Pulsação sutil dos quartos acesos e de suas lâmpadas
    if (apt.lit && !prefersReduced) {
      const pulse = Math.sin(elapsed * 0.5 + apt.x * 0.3) * 0.03;
      apt.glowMat.opacity = apt.currentOpacity + pulse;
      if (apt.lampGlowMat) {
        apt.lampGlowMat.opacity = 0.85 + pulse * 1.5;
      }
    }
  });

  // ── Pessoinhas: fade-in e atividade (estáticas, sem seguir a câmera) ──
  for (const person of persons) {
    const ud = person.group.userData;
    ud.time += dt;

    // Fade-in
    if (ud.targetOpacity !== ud.currentOpacity) {
      ud.currentOpacity += (ud.targetOpacity - ud.currentOpacity) * 0.04;
      if (Math.abs(ud.targetOpacity - ud.currentOpacity) < 0.001) {
        ud.currentOpacity = ud.targetOpacity;
      }
      ud.mat.opacity = ud.currentOpacity;
      ud.glowMat.opacity = ud.currentOpacity * 0.5;
    }

    // Bonequinhos estáticos na orientação do quarto (não seguem a câmera)
    person.group.rotation.y = 0;

    // Animação da atividade (balanço, digitação ou respiração na cama)
    if (!prefersReduced) {
      if (ud.update) {
        ud.update(elapsed, dt);
      } else {
        const sway = Math.sin(ud.time * 0.8 + ud.phase) * 0.03;
        person.group.rotation.z = sway;
      }
    }
  }

  // ── Postes: liga/desliga suave ──
  for (const post of posts) {
    const target = post.on ? 0.6 : 0.02;
    const current = post.haloMat.opacity;
    post.haloMat.opacity += (target - current) * 0.06;

    const lampTarget = post.on ? 0.95 : 0.08;
    post.lampMat.opacity += (lampTarget - post.lampMat.opacity) * 0.06;
  }

  // ── Lixeira: tampa ──
  const lidDiff = trashcan.targetLidAngle - trashcan.lidAngle;
  if (Math.abs(lidDiff) > 0.001) {
    trashcan.lidAngle += lidDiff * 0.06;
    trashcan.lidPivot.rotation.x = -trashcan.lidAngle;
  }

  // ── Porta: abrir/fechar ──
  if (building.doorLines.userData.animating) {
    const ud = building.doorLines.userData;
    if (ud.opening) {
      ud.openProgress = Math.min(1, (ud.openProgress || 0) + dt * 1.5);
      building.doorLines.rotation.y = ud.openProgress * Math.PI * 0.3;
      if (ud.openProgress >= 1) {
        ud.opening = false;
        setTimeout(() => {
          ud.closing = true;
        }, 1500);
      }
    }
    if (ud.closing) {
      ud.openProgress = Math.max(0, ud.openProgress - dt * 0.8);
      building.doorLines.rotation.y = ud.openProgress * Math.PI * 0.3;
      if (ud.openProgress <= 0) {
        ud.animating = false;
        ud.closing = false;
      }
    }
  }

  // ── Vaga-lume ──
  if (!mobileMode) {
    firefly.update(dt);
  }

  // ── Linha-guia ──
  guideLine.update(dt);

  // ── Atualizar posição da linha-guia se a câmera se mover ──
  if (hoveredApt && !mobileMode) {
    const apt = building.apartments.get(hoveredApt);
    if (apt && apt.lit) {
      const pos = new THREE.Vector3(apt.x, apt.y, BUILDING.unitDepth / 2 + 0.1);
      pos.project(camera);
      const screenX = (pos.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-pos.y * 0.5 + 0.5) * window.innerHeight;
      guideLine.updateScreenPos(
        { x: screenX, y: screenY },
        apt.morador.nome,
        apt.floor,
        hoveredApt
      );
    }
  }

  // ── Mobile zoom ──
  if (mobileZoom) {
    mobileZoom.update(dt);
  }

  // ── Render ──
  renderer.render(scene, camera);
}

animate();
