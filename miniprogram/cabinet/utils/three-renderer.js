// 3D 渲染器：基于 threejs-miniprogram + GLTFLoader。
// 用法：const r = new ThreeRenderer(); r.init(canvas, sizeInfo, { wall, hasRaise }); r.setItems(items); r.dispose();

const { createScopedThreejs } = require('threejs-miniprogram');
const attachGLTFLoader = require('../vendor/GLTFLoader.js');

const COLOR_HEX = {
  white: 0xf0f0e7,
  beige: 0xead8b8,
  gray: 0x8a8f99,
  wood: 0xb27d4a,
};

// 边线颜色（用于勾出板件轮廓，使柜体结构可见）
// 注：颜色不能太深、透明度不能太大，否则在浅色（白/米）柜体上密集叠加会把柜体染灰
const EDGE_HEX = 0x6b7280;
const EDGE_OPACITY = 0.22;
const EDGE_ANGLE = 35; // 折角阈值（度）：阈值越大边越少，减少密集线条堆积

const SCENE_DEPTH_CM = 150; // 房间深度 cm
const WALL_THICKNESS_CM = 10; // 墙体厚度 cm（左右、顶板、后墙均使用）
const FLOOR_THICKNESS_CM = 2; // 木地板厚度 cm
const CABINET_DEPTH_CM = 60;  // 标准衣柜深度 cm

// 模块级 GLB 二进制 buffer 缓存：跨 renderer 共享 readFile 出来的 ArrayBuffer。
// 不共享 gltfLoader.parse 出来的 scene —— 那个会让多个 renderer 共用同一批
// BufferAttribute / Material / Texture，threejs-miniprogram 的内部 attribute cache
// 在跨 renderer 场景下会拿到 stale buffer info，render 时 setIndex 取 .type 崩。
// 每个 renderer 自己 parse → 自己持有完全独立的 geo/mat/tex，行为与早期 per-renderer
// 缓存等价，只是省掉重复的 disk IO。
const GLB_BUFFER_CACHE = {};
const GLB_BUFFER_PROMISES = {};

class ThreeRenderer {
  constructor() {
    // 每个 renderer 自己的 parse 结果缓存：同一 renderer 内重复添加同一模型时
    // 走 root.clone(true)（renderer 内部 geo/mat 共享是安全的）
    this._loaderCache = {};
    this._cabinets = [];
    this._color = 'white';
    this._showDoor = false;
    this._rotX = 0;
    this._rotY = 0;
    this._zoom = 1;
  }

  // sizeInfo: { cssWidth, cssHeight, dpr }
  initRoom(canvas, sizeInfo, opts) {
    this.canvas = canvas;
    this.wall = opts.wall;
    this.hasRaise = opts.hasRaise;

    // 设置画布像素缓冲为 CSS 尺寸 × DPR
    const dpr = sizeInfo.dpr || 1;
    const w = Math.floor(sizeInfo.cssWidth * dpr);
    const h = Math.floor(sizeInfo.cssHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    console.log('[3D] canvas buffer', w, 'x', h, 'css', sizeInfo.cssWidth, 'x', sizeInfo.cssHeight);

    const THREE = createScopedThreejs(canvas);
    this.THREE = THREE;
    attachGLTFLoader(THREE);
    this.gltfLoader = new THREE.GLTFLoader();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfaf6ec);
    this.scene = scene;

    const aspect = w / h || 1;
    const fov = 45;
    const camera = new THREE.PerspectiveCamera(fov, aspect, 1, 5000);
    const dist = (this.wall.w / 2) / Math.tan((fov * Math.PI / 180) / 2) + this.wall.h * 0.5;
    camera.position.set(0, this.wall.h / 2, dist);
    camera.lookAt(0, this.wall.h / 2, 0);
    this.camera = camera;
    this._cameraDist = dist;

    // preserveDrawingBuffer: true 是 iOS 真机必需。默认 false 时 iOS 把上一帧
    // 主动清掉后再让 wx.canvasToTempFilePath 读，结果是 null / 黑图，导致
    // materials 页拿不到 previewImage、cost 页拿不到 wireframeImage。
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    // 色彩与色调映射：sRGB 输出 + ACES 电影感卷曲，防止色彩发脏与高光过曝
    // 曝光抬到 1.35：ACES 在 1.0 时高光会被卷得偏灰，纯白柜板视觉上会显灰
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 色彩与色调映射：sRGB 输出 + ACES 电影感卷曲，防止色彩发脏与高光过曝
    // 曝光抬到 1.35：ACES 在 1.0 时高光会被卷得偏灰，纯白柜板视觉上会显灰
    renderer.toneMappingExposure = 1.35;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer = renderer;

    // 注：小程序 WebGL 对 cubemap 上传支持不稳定（wx.createOffscreenCanvas 不一定能
    // 作为合法纹理源），开启 _buildEnv 风险较大。改用 _buildLights 里加强的灯光打底。
    // this._buildEnv();
    this._buildRoom();
    this._buildLights();

    // 提前异步加载原木贴图：用户切到原木色时一般已经就绪；就绪后若当前色仍是 wood
    // 会自动重新刷一遍所有柜体材质，把贴图盖上去。
    this._ensureWoodTexture();
    this._ensureWoodNormalTexture();
    // 同样提前预加载白色柜面贴图
    this._ensureWhiteTexture();

    this.startLoop();
    console.log('[3D] init done, wall', this.wall.w, '×', this.wall.h);
  }

  // 兼容旧调用：保留 init 作为 initRoom 的别名，待所有调用方迁移完毕后可移除
  init(canvas, sizeInfo, opts) {
    return this.initRoom(canvas, sizeInfo, opts);
  }

  // 预览画布：无房间、透明背景、固定俯视角度、简化光照
  // 用法：r.initPreview(canvas, { cssWidth, cssHeight, dpr }) 一次；
  // 之后 r.renderSingle(item, colorId) 多次
  initPreview(canvas, sizeInfo) {
    this.canvas = canvas;
    this._isPreview = true;

    const dpr = sizeInfo.dpr || 1;
    const w = Math.floor(sizeInfo.cssWidth * dpr);
    const h = Math.floor(sizeInfo.cssHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    console.log('[3D-preview] canvas buffer', w, 'x', h, 'css', sizeInfo.cssWidth, 'x', sizeInfo.cssHeight);

    const THREE = createScopedThreejs(canvas);
    this.THREE = THREE;
    attachGLTFLoader(THREE);
    this.gltfLoader = new THREE.GLTFLoader();

    const scene = new THREE.Scene();
    scene.background = null; // 透明，让 CSS 浅底色透出
    this.scene = scene;

    const aspect = w / h || 1;
    this.camera = new THREE.PerspectiveCamera(35, aspect, 1, 2000);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0); // 完全透明
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;

    // preview 用一个独立 group 放当前柜体，便于 clear/replace
    const previewGroup = new THREE.Group();
    scene.add(previewGroup);
    this._previewGroup = previewGroup;

    this._buildPreviewLights();

    // 预览缩略图同样可能用到原木贴图，提前加载
    this._ensureWoodTexture();
    this._ensureWoodNormalTexture();
    // 预览缩略图同样可能用到白色贴图，提前加载
    this._ensureWhiteTexture();
  }

  // preview 模式专用：3 盏简化灯，够照出柜体结构即可，不投阴影
  _buildPreviewLights() {
    const THREE = this.THREE;
    this.scene.add(new THREE.AmbientLight(0xfff1d6, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e0, 0.9);
    key.position.set(120, 220, 200);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xeef3ff, 0.35);
    fill.position.set(-150, 100, 150);
    this.scene.add(fill);
  }

  _clearPreviewCabinet() {
    if (!this._previewGroup) return;
    const old = this._previewGroup.children.slice();
    old.forEach((child) => {
      this._previewGroup.remove(child);
      // 递归释放 GPU 资源
      child.traverse && child.traverse((n) => {
        if (n.geometry && n.geometry.dispose) n.geometry.dispose();
        if (n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach((m) => m && m.dispose && m.dispose());
        }
      });
    });
  }

  // 加载单个柜型、按 colorId 着色、render 一帧
  // item 形如 { code, w, h, kind = 'standard' }
  async renderSingle(item, colorId) {
    if (!this._isPreview) throw new Error('renderSingle only available in preview mode');
    // 记下当前色，配合 _ensureWoodTexture 就绪后重刷预览柜体
    this._color = colorId;
    // edge 线随色变（同 setColor 逻辑）
    this._syncEdgeMatToColor(colorId);
    this._clearPreviewCabinet();

    const mesh = await this._loadItemMesh(item);
    if (!mesh) return;

    const THREE = this.THREE;
    const group = new THREE.Group();
    group.add(mesh);
    // 记下该预览柜体的 item，便于 white 贴图异步就绪后回调里按尺寸重算 repeat
    group.userData._item = item;

    // 沿用 room 模式的等比缩放/居中逻辑
    const CABINET_DEPTH_CM = 60;
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const sx = size.x > 0.001 ? item.w / size.x : 1;
    const sy = size.y > 0.001 ? item.h / size.y : 1;
    const sz = size.z > 0.001 ? CABINET_DEPTH_CM / size.z : 1;
    mesh.scale.set(sx, sy, sz);
    const bbox2 = new THREE.Box3().setFromObject(mesh);
    mesh.position.y -= bbox2.min.y;
    mesh.position.x -= (bbox2.min.x + bbox2.max.x) / 2;
    mesh.position.z -= (bbox2.min.z + bbox2.max.z) / 2;

    this._stripNonGeometryNodes(group);
    this._normalizeMaterials(group);
    this._applyMaterial(group, colorId, item);
    // 原木色但贴图还没就绪：触发加载；就绪后 _ensureWoodTexture 会重刷预览
    if (colorId === 'wood' && !this._woodTexture) {
      this._ensureWoodTexture();
    }
    // 白色但贴图还没就绪：触发加载；就绪后 _ensureWhiteTexture 会重刷预览
    if (colorId === 'white' && !this._whiteImage) {
      this._ensureWhiteTexture();
    }
    this._applyEdges(group);
    this._applyDoorVisibility(group);

    // 水平视角、向左偏转 ~21°：相机正对柜体中部高度，柜体本身绕 Y 转出 3D 感
    group.position.set(0, 0, 0);
    group.rotation.set(0, -0.375, 0);

    this._previewGroup.add(group);

    // 根据柜体尺寸刷新相机：正对柜体几何中心，不抬不俯
    // 1.85 倍 diag 是兼顾"窄高柜（如 50A 230cm 高）+ Y 轴偏转 → 最近面透视突出"的下限：
    // 太近（1.6 倍）50cm 柜顶/底会出视锥；再远（>2.0）柜体在 cell 里又显得太小留太多空白
    const diag = Math.sqrt(item.w * item.w + item.h * item.h + CABINET_DEPTH_CM * CABINET_DEPTH_CM);
    const dist = diag * 1.85;
    this.camera.position.set(0, item.h * 0.5, dist);
    this.camera.lookAt(0, item.h * 0.5, 0);
    this.camera.updateProjectionMatrix && this.camera.updateProjectionMatrix();

    // 同步渲一帧，便于 wx.canvasToTempFilePath 立刻取到画面
    this.renderer.render(this.scene, this.camera);
  }

  // 程序化生成 Studio 软光 CubeTexture，注入 scene.environment 作为 IBL。
  // 由于 threejs-miniprogram 不包含 PMREMGenerator/RGBELoader，这里用 6 张离屏 canvas
  // 模拟摄影棚柔光箱（顶部主光、左右反光板、暗底、远景），让 MeshStandardMaterial 的
  // envMap 自动接管哑光材质的反射，从根本上让色彩"出质感"。
  _buildEnv() {
    const THREE = this.THREE;
    if (!THREE || !THREE.CubeTexture) return;
    const faces = this._makeStudioCubeFaces(256);
    if (!faces) return;
    try {
      const cube = new THREE.CubeTexture(faces);
      if (THREE.sRGBEncoding) cube.encoding = THREE.sRGBEncoding;
      if (THREE.LinearFilter) {
        cube.minFilter = THREE.LinearFilter;
        cube.magFilter = THREE.LinearFilter;
      }
      cube.generateMipmaps = false;
      cube.needsUpdate = true;
      this.scene.environment = cube;
      this._envCube = cube;
    } catch (e) {
      console.warn('[3D] env cube setup failed', e && e.message);
    }
  }

  // 返回 [px, nx, py, ny, pz, nz] 6 个画好的离屏 canvas
  _makeStudioCubeFaces(size) {
    const out = [];
    const drawers = [
      // +X 右反光板：从左向右渐弱的柔光带
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, size, 0);
        g.addColorStop(0, '#f4ead4');
        g.addColorStop(0.55, '#e8dcc0');
        g.addColorStop(1, '#3a3a38');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      },
      // -X 左反光板：镜像
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, size, 0);
        g.addColorStop(0, '#3a3a38');
        g.addColorStop(0.45, '#e8dcc0');
        g.addColorStop(1, '#f4ead4');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      },
      // +Y 顶部柔光箱：中心高光圆斑 + 大范围暖光
      (ctx) => {
        ctx.fillStyle = '#f0e6d0';
        ctx.fillRect(0, 0, size, size);
        const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.55);
        g.addColorStop(0, '#fffaf0');
        g.addColorStop(0.45, '#fff3da');
        g.addColorStop(1, 'rgba(240,230,208,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      },
      // -Y 底部：暗灰吸光
      (ctx) => {
        ctx.fillStyle = '#252523';
        ctx.fillRect(0, 0, size, size);
      },
      // +Z / -Z 前后远景：浅灰渐变
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, '#dcdad6');
        g.addColorStop(1, '#9e9c98');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      },
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, '#dcdad6');
        g.addColorStop(1, '#9e9c98');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      },
    ];
    try {
      for (let i = 0; i < 6; i++) {
        const cv = wx.createOffscreenCanvas
          ? wx.createOffscreenCanvas({ type: '2d', width: size, height: size })
          : null;
        if (!cv) return null;
        const ctx = cv.getContext('2d');
        drawers[i](ctx);
        out.push(cv);
      }
      return out;
    } catch (e) {
      console.warn('[3D] make studio cube faces failed', e && e.message);
      return null;
    }
  }

  _buildRoom() {
    const THREE = this.THREE;
    const W = this.wall.w;
    const H = this.wall.h;
    const D = SCENE_DEPTH_CM;
    const T = WALL_THICKNESS_CM;
    const room = new THREE.Group();
    this.scene.add(room);
    this._roomGroup = room;

    // 墙体使用带厚度的 Box 几何体；浅米色乳胶漆效果
    const wallColor = 0xfff3d4;
    const floorColor = 0xc9a373;
    const ceilColor = 0xfff8e7;

    // 乳胶漆颗粒感：用程序生成的噪声纹理同时作 bump（凹凸）和 roughness（粗糙度变化）
    const wallNoiseTex = this._makeWallNoiseTexture(128, 0.55);
    if (wallNoiseTex) {
      // 每隔约 20cm 重复一次，颗粒密度合适
      const rx = Math.max(2, Math.round(W / 20));
      const ry = Math.max(2, Math.round(H / 20));
      wallNoiseTex.repeat.set(rx, ry);
    }

    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.95,
      metalness: 0,
      bumpMap: wallNoiseTex || null,
      bumpScale: wallNoiseTex ? 0.6 : 0,
      roughnessMap: wallNoiseTex || null,
    });
    this._wallMat = wallMat;
    // 异步加载 utils/wall.png 作为左/右/后墙的颜色贴图；就绪后挂到 wallMat.map 上，
    // 同时把 wallMat.color 改成白色避免反向 tint，并按物理尺寸调 tile 密度。
    // 失败则保留乳胶漆色 + 程序噪声（即原效果）。
    this._ensureWallTexture(W, H);
    const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.6 });
    this._floorMat = floorMat;
    // 异步加载 utils/floor.jpg 作为木地板顶面颜色贴图；就绪后挂到 floorMat.map 上，
    // 同时把 floorMat.color 改成白色避免反向 tint，并按物理尺寸调 tile 密度。
    // 失败则保留原木色纯色。
    this._ensureFloorTexture(W, D);
    const ceilMat = new THREE.MeshStandardMaterial({
      color: ceilColor,
      roughness: 0.9,
      emissive: 0xfff2c2,
      emissiveIntensity: 0.15,
    });

    // 后墙：四周与其他墙体外表面齐平
    // 横向 W+2T（与左右墙外表面 ±(W/2+T) 齐）；纵向 H+2T（与左右墙上下端 -T / H+T 齐）
    // 厚度向 -z 方向延伸至 z=-D-T；前表面位于 z=-D
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + T * 2, H + T * 2, T), wallMat);
    back.position.set(0, H / 2, -D - T / 2);
    back.receiveShadow = true;
    room.add(back);

    // 墙体底面总厚度 T（10cm）：上表 2cm 为木地板，下方 8cm 为墙体（与其他墙同材质），横向只在 ±W/2 之内
    const FT = FLOOR_THICKNESS_CM;
    const BASE_T = T - FT;
    // 上层 2cm 木地板：y ∈ [-FT, 0]
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, FT, D), floorMat);
    floor.position.set(0, -FT / 2, -D / 2);
    floor.receiveShadow = true;
    room.add(floor);
    // 下层 8cm 墙体基底：y ∈ [-T, -FT]
    const floorBase = new THREE.Mesh(new THREE.BoxGeometry(W, BASE_T, D), wallMat);
    floorBase.position.set(0, -FT - BASE_T / 2, -D / 2);
    room.add(floorBase);

    // 顶板：下表面位于 y=H，横向只在 ±W/2 之内（嵌在左右墙之间）
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), ceilMat);
    ceil.position.set(0, H + T / 2, -D / 2);
    room.add(ceil);

    // 左墙：内表面位于 x=-W/2，厚度向 -x 延伸；纵向 H+2T（向上向下各延伸 T）"包"住顶板和地板的外端
    const left = new THREE.Mesh(new THREE.BoxGeometry(T, H + T * 2, D), wallMat);
    left.position.set(-W / 2 - T / 2, H / 2, -D / 2);
    left.receiveShadow = true;
    room.add(left);

    // 右墙：内表面位于 x=W/2，纵向 H+2T 同左
    const right = new THREE.Mesh(new THREE.BoxGeometry(T, H + T * 2, D), wallMat);
    right.position.set(W / 2 + T / 2, H / 2, -D / 2);
    right.receiveShadow = true;
    room.add(right);
  }

  // 生成乳胶漆颗粒感噪声纹理（DataTexture，RGBA 灰度噪声）
  _makeWallNoiseTexture(size, intensity) {
    const THREE = this.THREE;
    if (!THREE || !THREE.DataTexture) return null;
    try {
      const N = size * size;
      const data = new Uint8Array(N * 4);
      for (let i = 0; i < N; i++) {
        // 以 180 为基准（接近中性灰），叠加 ±intensity*255/2 的噪声
        const noise = (Math.random() - 0.5) * 255 * intensity;
        const v = Math.max(60, Math.min(240, Math.round(180 + noise)));
        data[i * 4 + 0] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      if (THREE.LinearFilter) {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
      }
      return tex;
    } catch (e) {
      console.warn('[3D] make wall noise texture failed', e);
      return null;
    }
  }

  _buildLights() {
    const THREE = this.THREE;
    const W = this.wall.w;
    const H = this.wall.h;

    // 暖色环境光：撑底色（无 IBL 时这一层要扛起整体亮度）
    this.scene.add(new THREE.AmbientLight(0xfff1d6, 0.55));

    // 45° 斜顶主光：从右上前方进入，开 PCF 软阴影
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.15);
    dir.position.set(W * 0.6, H * 1.4, this._cameraDist * 0.6);
    dir.target.position.set(0, H * 0.4, -SCENE_DEPTH_CM / 2);
    this.scene.add(dir.target);
    dir.castShadow = true;
    if (dir.shadow) {
      // 512×512 比 1024 更安全：小程序 WebGL 在中低端机上对大阴影贴图易掉帧
      dir.shadow.mapSize.set(512, 512);
      const cam = dir.shadow.camera;
      const span = Math.max(W, H) * 0.8;
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.near = H * 0.2;
      cam.far = H * 3.5;
      if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
      dir.shadow.bias = -0.0008;
      dir.shadow.normalBias = 0.02;
      dir.shadow.radius = 3;
    }
    this.scene.add(dir);

    // 左侧冷色补光：消除暗面，不投阴影
    const fill = new THREE.DirectionalLight(0xeef3ff, 0.45);
    fill.position.set(-W * 0.5, H * 0.6, this._cameraDist * 0.4);
    this.scene.add(fill);

    // 顶部均匀暖光：用一个朝下的方向光把整片顶板/上半部空间均匀打亮，
    // 替代原本紧贴顶板的点光源——避免在顶面留一个亮斑。
    // 顶板本身的 emissive 负责"微微发光"的质感。
    const topWash = new THREE.DirectionalLight(0xfff2c2, 0.35);
    topWash.position.set(0, H * 2, -SCENE_DEPTH_CM / 2);
    topWash.target.position.set(0, 0, -SCENE_DEPTH_CM / 2);
    this.scene.add(topWash.target);
    this.scene.add(topWash);
  }

  // 给柜体内部添加隐藏点光源，模拟宜家内置 LED 灯带；不投阴影以省 GPU
  _addInnerStripLights(group, item) {
    const THREE = this.THREE;
    if (!THREE.PointLight) return;
    const stripColor = 0xfff0d4;
    const strip = new THREE.PointLight(stripColor, 0.4, 80, 2);
    // 柜内顶部偏前；group 已居中（柜体已 recenter），所以 z=10 朝外略偏柜门一侧
    strip.position.set(0, item.h - 8, 10);
    group.add(strip);
    if (item.h >= 160) {
      const mid = new THREE.PointLight(stripColor, 0.25, 60, 2);
      mid.position.set(0, item.h * 0.5, 10);
      group.add(mid);
    }
  }

  // 移除 SketchUp 视口节点与任何文字/标注几何，保证渲染出来就是纯柜体
  _stripNonGeometryNodes(group) {
    if (!group) return;
    const blacklist = ['active view', 'text', 'label', 'annotation', 'dimension', '文字', '字'];
    const toRemove = [];
    group.traverse((node) => {
      const nm = (node.name || '').toLowerCase();
      if (!nm) return;
      if (blacklist.some((k) => nm.indexOf(k) >= 0)) toRemove.push(node);
    });
    toRemove.forEach((n) => {
      if (n.parent) n.parent.remove(n);
    });
  }

  // 统一 glb 材质的色彩空间与环境反射强度，让 IBL 真正作用于哑光材质
  _normalizeMaterials(group) {
    const THREE = this.THREE;
    group.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.map && THREE.sRGBEncoding) m.map.encoding = THREE.sRGBEncoding;
        if (m.emissiveMap && THREE.sRGBEncoding) m.emissiveMap.encoding = THREE.sRGBEncoding;
        if ('envMapIntensity' in m) m.envMapIntensity = 0.8;
        if ('roughness' in m && (m.roughness === undefined || m.roughness === null)) {
          m.roughness = 0.7;
        }
        m.needsUpdate = true;
      });
    });
  }

  startLoop() {
    const tick = () => {
      this._raf = this.canvas.requestAnimationFrame(tick);
      if (this._roomGroup) {
        this._roomGroup.rotation.x = this._rotX;
        this._roomGroup.rotation.y = this._rotY;
      }
      this.camera.position.z = this._cameraDist / this._zoom;
      this.camera.lookAt(0, this.wall.h / 2, 0);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  setRotation(rx, ry) {
    const clamp = (v) => Math.max(-Math.PI / 6, Math.min(Math.PI / 6, v));
    this._rotX = clamp(rx);
    this._rotY = clamp(ry);
  }

  setZoom(z) {
    this._zoom = Math.max(0.5, Math.min(2.5, z));
  }

  setShowDoor(v) {
    this._showDoor = !!v;
    this._cabinets.forEach((c) => this._applyDoorVisibility(c.mesh));
  }

  // 按当前柜体色返回 edge 线的样式。白色柜体下板缝密集叠加 0x6b7280 / 0.22 会把
  // 柜面整体染灰，所以单独走极淡的浅灰；其他色保留原值，保证板件结构依然可读。
  _edgeStyleFor(colorId) {
    if (colorId === 'white') return { hex: 0xb0b6c0, opacity: 0.10 };
    return { hex: EDGE_HEX, opacity: EDGE_OPACITY };
  }

  // 全部柜体共享同一条 edge 材质，setColor / renderSingle 切色时只需更新这条材质
  // 上的 color 与 opacity，所有已落地的 LineSegments 立刻同步。
  _getEdgeMat() {
    if (this._edgeMat) return this._edgeMat;
    const THREE = this.THREE;
    if (!THREE.LineBasicMaterial) return null;
    const style = this._edgeStyleFor(this._color);
    this._edgeMat = new THREE.LineBasicMaterial({
      color: style.hex,
      transparent: true,
      opacity: style.opacity,
    });
    return this._edgeMat;
  }

  _syncEdgeMatToColor(colorId) {
    if (!this._edgeMat) return;
    const style = this._edgeStyleFor(colorId);
    this._edgeMat.color.setHex(style.hex);
    this._edgeMat.opacity = style.opacity;
    this._edgeMat.needsUpdate = true;
  }

  // 给柜体的每一个 Mesh 叠加一层细黑边线，让板件结构（侧板/层板/抽屉等）从外观上能看出
  _applyEdges(group) {
    if (!group) return;
    const THREE = this.THREE;
    if (!THREE.EdgesGeometry || !THREE.LineSegments || !THREE.LineBasicMaterial) return;
    const mat = this._getEdgeMat();
    if (!mat) return;
    group.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      if (node.userData && node.userData._edged) return;
      try {
        const eg = new THREE.EdgesGeometry(node.geometry, EDGE_ANGLE);
        const ls = new THREE.LineSegments(eg, mat);
        ls.userData._isEdge = true;
        node.add(ls);
        node.userData._edged = true;
      } catch (e) {
        // 某些几何体可能不支持，跳过即可
      }
    });
  }

  _applyDoorVisibility(group) {
    if (!group) return;
    group.traverse((node) => {
      const raw = node.name || '';
      const lower = raw.toLowerCase();
      // 注：不再用 'men' 子串匹配——它会误中 compartment / movement
      // / SketchUp 默认节点名等无关板件，导致柜内层板被一起隐藏，
      // 视觉上只剩一个无细节的白盒子。
      const isDoor =
        /(^|[^a-z])door([^a-z]|$)/.test(lower) ||
        raw.indexOf('门') >= 0;
      if (isDoor) {
        node.visible = this._showDoor;
      }
    });
  }

  setColor(colorId) {
    this._color = colorId;
    this._cabinets.forEach((c) => this._applyMaterial(c.mesh, colorId, c.item));
    // edge 线随色变（白色用更淡的浅灰，避免密集板缝把白柜染灰）
    this._syncEdgeMatToColor(colorId);
    // 切到原木色且贴图还没就绪：把加载顶起来；就绪回调里会再刷一遍
    if (colorId === 'wood' && !this._woodTexture) {
      this._ensureWoodTexture();
    }
    // 切到白色且贴图还没就绪：同样触发加载
    if (colorId === 'white' && !this._whiteImage) {
      this._ensureWhiteTexture();
    }
  }

  // 懒加载 utils/white1000.png → 仅缓存 Image 对象（不缓存 Texture）。
  // 原因：Texture.repeat 是材质级状态，每个柜体的 w/h 不同，必须各自一份 Texture
  // 才能独立设 repeat。共享 Image、每柜 new Texture，WebGL 上传层会识别同一 Image
  // 复用 GPU 端的纹理上传，开销可忽略。加载成功后若当前 _color 仍是 white，把所有
  // 已落地的柜体 & 预览柜体材质重刷一遍把贴图盖上去。
  _ensureWhiteTexture() {
    if (this._whiteImage) return Promise.resolve(this._whiteImage);
    if (this._whiteImagePromise) return this._whiteImagePromise;
    if (!this.canvas || !this.THREE || !this.canvas.createImage) {
      return Promise.resolve(null);
    }
    this._whiteImagePromise = new Promise((resolve) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        this._whiteImage = img;
        // 就绪后若当前色是白色，把已落地的柜体 & 预览柜体全部重刷一遍
        if (this._color === 'white') {
          if (this._cabinets && this._cabinets.length) {
            this._cabinets.forEach((c) => this._applyMaterial(c.mesh, 'white', c.item));
          }
          if (this._previewGroup) {
            this._previewGroup.children.forEach((g) => {
              this._applyMaterial(g, 'white', g.userData && g.userData._item);
            });
            // 预览模式同步渲一帧，让 wx.canvasToTempFilePath 能立即取到带贴图的画面
            if (this._isPreview && this.renderer && this.scene && this.camera) {
              try { this.renderer.render(this.scene, this.camera); } catch (e) { /* ignore */ }
            }
          }
        }
        resolve(img);
      };
      img.onerror = (e) => {
        console.warn('[3D] white texture load failed', e && (e.errMsg || e.message));
        this._whiteImagePromise = null; // 允许下次重试
        resolve(null);
      };
      img.src = '/cabinet/utils/white1000.png';
    });
    return this._whiteImagePromise;
  }

  // 懒加载 utils/wood.jpg → THREE.Texture。每个 renderer 各持一份（Texture 与 WebGL
  // 上下文绑定，跨 renderer 共享会出 GPU 资源串扰）。加载成功后若当前 _color 仍是
  // wood，会把所有已落地的柜体材质重刷一遍把贴图盖上去。
  _ensureWoodTexture() {
    if (this._woodTexture) return Promise.resolve(this._woodTexture);
    if (this._woodTexturePromise) return this._woodTexturePromise;
    if (!this.canvas || !this.THREE || !this.canvas.createImage) {
      return Promise.resolve(null);
    }
    const THREE = this.THREE;
    this._woodTexturePromise = new Promise((resolve) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        if (THREE.RepeatWrapping) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        tex.needsUpdate = true;
        this._woodTexture = tex;
        // 就绪后若当前色是原木，把已落地的柜体 & 预览柜体全部重刷一遍
        if (this._color === 'wood') {
          if (this._cabinets && this._cabinets.length) {
            this._cabinets.forEach((c) => this._applyMaterial(c.mesh, 'wood', c.item));
          }
          if (this._previewGroup) {
            this._previewGroup.children.forEach((g) => {
              this._applyMaterial(g, 'wood', g.userData && g.userData._item);
            });
          }
        }
        resolve(tex);
      };
      img.onerror = (e) => {
        console.warn('[3D] wood texture load failed', e && (e.errMsg || e.message));
        this._woodTexturePromise = null; // 允许下次重试
        resolve(null);
      };
      img.src = '/cabinet/utils/wood.jpg';
    });
    return this._woodTexturePromise;
  }

  // 懒加载 utils/wood_NormalMap.jpg → THREE.Texture，作为原木色柜体的法线贴图。
  // 法线贴图比 bumpMap 能准确表达木纹方向（凹凸 + 光照角度），让木板有真正的浮雕感。
  // 失败时静默回退（仅 wood map 生效，没有法线浮雕，与未做这一步等价）。
  _ensureWoodNormalTexture() {
    if (this._woodNormalTexture) return Promise.resolve(this._woodNormalTexture);
    if (this._woodNormalTexturePromise) return this._woodNormalTexturePromise;
    if (!this.canvas || !this.THREE || !this.canvas.createImage) {
      return Promise.resolve(null);
    }
    const THREE = this.THREE;
    this._woodNormalTexturePromise = new Promise((resolve) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        // 法线贴图必须是 linear 空间，不能加 sRGB encoding，否则法线方向被 gamma 曲线扭曲
        if (THREE.RepeatWrapping) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        tex.needsUpdate = true;
        this._woodNormalTexture = tex;
        // 就绪后若当前色是原木，把已落地的柜体 & 预览柜体重刷一遍把 normalMap 盖上去
        if (this._color === 'wood') {
          if (this._cabinets && this._cabinets.length) {
            this._cabinets.forEach((c) => this._applyMaterial(c.mesh, 'wood', c.item));
          }
          if (this._previewGroup) {
            this._previewGroup.children.forEach((g) => {
              this._applyMaterial(g, 'wood', g.userData && g.userData._item);
            });
            if (this._isPreview && this.renderer && this.scene && this.camera) {
              try { this.renderer.render(this.scene, this.camera); } catch (e) { /* ignore */ }
            }
          }
        }
        resolve(tex);
      };
      img.onerror = (e) => {
        console.warn('[3D] wood normal map load failed', e && (e.errMsg || e.message));
        this._woodNormalTexturePromise = null; // 允许下次重试
        resolve(null);
      };
      img.src = '/cabinet/utils/wood_NormalMap.jpg';
    });
    return this._woodNormalTexturePromise;
  }

  // 懒加载 utils/wall.png → 挂到 _wallMat.map 上，给左/右/后墙（以及共享同材质的
  // floorBase 8cm 基底）做颜色贴图。tile 密度按物理尺寸 ~每 80cm 一格估算，避免
  // 大墙面看到明显接缝。失败时静默保留原乳胶漆纯色 + 噪声 bump。
  _ensureWallTexture(W, H) {
    if (!this._wallMat) return Promise.resolve(null);
    if (this._wallTexture) return Promise.resolve(this._wallTexture);
    if (this._wallTexturePromise) return this._wallTexturePromise;
    if (!this.canvas || !this.THREE || !this.canvas.createImage) {
      return Promise.resolve(null);
    }
    const THREE = this.THREE;
    this._wallTexturePromise = new Promise((resolve) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        if (THREE.RepeatWrapping) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        // 接缝抑制策略：让 tile 的"物理边长"≥ 整面墙的边长，repeat 取 ceil(尺寸/300cm)
        // 并兜底为 1 —— 这样常见 200~300cm 的墙正好走 1×1，根本看不到接缝；
        // 大墙才会出现 2×1 / 2×2 这种少量重复。砂浆细颗粒贴图被拉伸 1.x 倍肉眼无感。
        const TILE_CM = 300;
        const rx = Math.max(1, Math.ceil((W || TILE_CM) / TILE_CM));
        const ry = Math.max(1, Math.ceil((H || TILE_CM) / TILE_CM));
        tex.repeat.set(rx, ry);
        // 各向异性过滤：左/右墙是斜视面，没有这个会有明显的远端糊化条纹
        try {
          const maxAniso = this.renderer && this.renderer.capabilities
            && this.renderer.capabilities.getMaxAnisotropy
            && this.renderer.capabilities.getMaxAnisotropy();
          if (maxAniso) tex.anisotropy = Math.min(8, maxAniso);
        } catch (e) { /* ignore */ }
        tex.needsUpdate = true;
        this._wallTexture = tex;
        // 挂到共享 wallMat 上；color 转白避免反向 tint；噪声 bump 保留增强凹凸
        const mat = this._wallMat;
        if (mat) {
          mat.map = tex;
          if (mat.color) mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
        }
        resolve(tex);
      };
      img.onerror = (e) => {
        console.warn('[3D] wall texture load failed', e && (e.errMsg || e.message));
        this._wallTexturePromise = null;
        resolve(null);
      };
      img.src = '/cabinet/utils/wall.png';
    });
    return this._wallTexturePromise;
  }

  // 懒加载 utils/floor.jpg → 挂到 _floorMat.map 上，给木地板顶面做颜色贴图。
  // tile 密度按物理尺寸 ~每 150cm 一格估算，避免木纹方向被拉伸过大。
  // 失败时静默保留原木色纯色（即原效果）。
  _ensureFloorTexture(W, D) {
    if (!this._floorMat) return Promise.resolve(null);
    if (this._floorTexture) return Promise.resolve(this._floorTexture);
    if (this._floorTexturePromise) return this._floorTexturePromise;
    if (!this.canvas || !this.THREE || !this.canvas.createImage) {
      return Promise.resolve(null);
    }
    const THREE = this.THREE;
    this._floorTexturePromise = new Promise((resolve) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        if (THREE.RepeatWrapping) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        // tile 跟随墙宽自动缩放：宽方向 1 张 floor.jpg 正好铺满整面墙宽（repeat.x=1，
        // 横向无接缝），深度方向按图像原始宽高比铺设，保证木纹 45° 角不被各向异性拉伸。
        // 推导：单张贴图的物理宽度被钉成 W cm；按原图宽高比，贴图在深度方向占
        //   tileDepthCm = W / aspect cm；要覆盖深度 D，repeat.y = D / tileDepthCm = D * aspect / W。
        // 极宽墙（W > D*aspect）→ repeat.y < 1，仅看到原图局部，无接缝；
        // 窄墙（W < D*aspect）→ repeat.y > 1，在深度方向铺多张，接缝藏在远端靠近后墙处。
        const aspect = (img.width && img.height) ? (img.width / img.height) : 1;
        const W_safe = Math.max(W || 1, 1);
        tex.repeat.set(1, (D * aspect) / W_safe);
        try {
          const maxAniso = this.renderer && this.renderer.capabilities
            && this.renderer.capabilities.getMaxAnisotropy
            && this.renderer.capabilities.getMaxAnisotropy();
          if (maxAniso) tex.anisotropy = Math.min(8, maxAniso);
        } catch (e) { /* ignore */ }
        tex.needsUpdate = true;
        this._floorTexture = tex;
        const mat = this._floorMat;
        if (mat) {
          mat.map = tex;
          if (mat.color) mat.color.setHex(0xffffff);
          mat.needsUpdate = true;
        }
        resolve(tex);
      };
      img.onerror = (e) => {
        console.warn('[3D] floor texture load failed', e && (e.errMsg || e.message));
        this._floorTexturePromise = null;
        resolve(null);
      };
      img.src = '/cabinet/utils/floor.jpg';
    });
    return this._floorTexturePromise;
  }

  // 统一柜体着色入口：原木色用 wood.jpg 贴图、白色用 white1000.png 贴图
  // （任一贴图未就绪时回退到对应纯色 hex），其余色用纯色并清掉 map。
  // item: { w, h }，用于按柜体物理尺寸计算 white 贴图的 repeat（每张代表 100cm×100cm）。
  _applyMaterial(group, colorId, item) {
    if (!group) return;
    const THREE = this.THREE;
    const useWood = colorId === 'wood' && !!this._woodTexture;
    const useWhiteTex = colorId === 'white' && !!this._whiteImage;
    const hex = COLOR_HEX[colorId] || COLOR_HEX.white;
    const flatColor = new THREE.Color(hex);
    const whiteTintColor = (useWood || useWhiteTex) ? new THREE.Color(0xffffff) : null;

    // 为本次着色构造一份独立 Texture：repeat 是材质级状态，多柜共享会互相覆盖，
    // 所以每柜（每次 _applyMaterial）都基于共享的 _whiteImage 新建一个 Texture 包装层。
    // WebGL 上传层会识别同一 Image，GPU 端只占一份纹理内存。
    let whiteTex = null;
    if (useWhiteTex) {
      whiteTex = new THREE.Texture(this._whiteImage);
      if (THREE.RepeatWrapping) {
        whiteTex.wrapS = THREE.RepeatWrapping;
        whiteTex.wrapT = THREE.RepeatWrapping;
      }
      if (THREE.sRGBEncoding) whiteTex.encoding = THREE.sRGBEncoding;
      const w = (item && item.w) || 100;
      const h = (item && item.h) || 100;
      // 1 张 white1000.png 代表 100cm × 100cm 真实柜面
      whiteTex.repeat.set(w / 100, h / 100);
      try {
        const maxAniso = this.renderer && this.renderer.capabilities
          && this.renderer.capabilities.getMaxAnisotropy
          && this.renderer.capabilities.getMaxAnisotropy();
        if (maxAniso) whiteTex.anisotropy = Math.min(8, maxAniso);
      } catch (e) { /* ignore */ }
      whiteTex.needsUpdate = true;
    }

    group.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      // 跳过保留固有色的部件：背板（突出纵深）、挂衣杆（金属）
      const nm = (node.name || '').toLowerCase();
      if (nm === 'back' || nm === 'rod') return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (!m) return;
        if (useWood) {
          if ('map' in m) m.map = this._woodTexture;
          // wood_NormalMap.jpg 作为 bumpMap 使用：threejs-miniprogram 下 GLTF 模型缺少
          // 切线 attribute，normalMap 路径会让柜面渲染成全黑。bumpMap 走灰度梯度算法，
          // 不依赖切线，能稳定表达木纹凹凸。bumpScale 小一些避免凹凸过头。
          if ('normalMap' in m) m.normalMap = null;
          if ('bumpMap' in m) m.bumpMap = this._woodNormalTexture || null;
          if ('bumpScale' in m) m.bumpScale = this._woodNormalTexture ? 0.4 : 0;
          // map 需要 color 为白才不会被反向 tint
          if (m.color) m.color.copy(whiteTintColor);
        } else if (useWhiteTex) {
          if ('map' in m) m.map = whiteTex;
          if ('normalMap' in m) m.normalMap = null;
          if ('bumpMap' in m) m.bumpMap = null;
          if ('bumpScale' in m) m.bumpScale = 0;
          if (m.color) m.color.copy(whiteTintColor);
        } else {
          if ('map' in m) m.map = null;
          if ('normalMap' in m) m.normalMap = null;
          if ('bumpMap' in m) m.bumpMap = null;
          if ('bumpScale' in m) m.bumpScale = 0;
          if (m.color) m.color.copy(flatColor);
        }
        // 柜体自发光关闭：emissive=0 + 完全哑光 roughness=1.0，去塑料感的最终方案。
        if (m.emissive && m.emissive.setHex) m.emissive.setHex(0x000000);
        if ('emissiveIntensity' in m) m.emissiveIntensity = 0;
        // 完全哑光板材：roughness 推到 1.0，彻底消除镜面反射高光。
        // 原木色单独放宽到 0.75：真实木材有轻微清漆反光，全 1.0 会显得像未上漆纤维板。
        if ('roughness' in m) m.roughness = useWood ? 0.75 : 1.0;
        if ('metalness' in m) m.metalness = 0;
        m.needsUpdate = true;
      });
    });
  }

  // items 可为数组（仅底层）或 { bottom: [], top: [] } 形态（带加高模块）
  async setItems(items) {
    if (!this._roomGroup) return;
    const bottom = Array.isArray(items) ? items : (items.bottom || []);
    const top = Array.isArray(items) ? [] : (items.top || []);
    // 清旧
    this._cabinets.forEach((c) => this._roomGroup.remove(c.mesh));
    this._cabinets = [];

    await this._placeRow(bottom, 0);
    await this._placeRow(top, 230);
    console.log('[3D] setItems done bottom', bottom.length, 'top', top.length);
  }

  async _placeRow(rowItems, yBase) {
    let cursor = -this.wall.w / 2;
    for (const it of rowItems) {
      cursor += it.w / 2;
      // spacer 仅占用 cursor 宽度（用于右转角预览的位置占位），不加载几何
      if (it.kind === 'spacer') {
        cursor += it.w / 2;
        continue;
      }
      const mesh = await this._loadItemMesh(it);
      if (mesh) {
        const THREE = this.THREE;
        const group = new THREE.Group();
        group.add(mesh);
        const bbox = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const sx = size.x > 0.001 ? it.w / size.x : 1;
        const sy = size.y > 0.001 ? it.h / size.y : 1;
        // 转角柜物理 depth = 宽 = 110cm，转角加高（yg/zg）同样 110；
        // 其它柜体（标准/非标/普通加高 g）仍用 CABINET_DEPTH_CM(60)
        const isCornerLike =
          it.kind === 'corner' ||
          (it.kind === 'raise' && (it.code === 'yg' || it.code === 'zg'));
        const targetDepth = isCornerLike ? 110 : CABINET_DEPTH_CM;
        const sz = size.z > 0.001 ? targetDepth / size.z : 1;
        mesh.scale.set(sx, sy, sz);
        const bbox2 = new THREE.Box3().setFromObject(mesh);
        mesh.position.y -= bbox2.min.y;
        mesh.position.x -= (bbox2.min.x + bbox2.max.x) / 2;
        mesh.position.z -= (bbox2.min.z + bbox2.max.z) / 2;
        // 衣柜后表面贴后墙：转角柜中心 z = -D + 110/2 = -95，其它柜体 z = -D + 30
        const cabZ = -SCENE_DEPTH_CM + targetDepth / 2;
        group.position.set(cursor, yBase, cabZ);
        // 柜体板件互投阴影 + 接收阴影；点光源不投影以保性能
        group.traverse((n) => {
          if (n.isMesh) {
            n.castShadow = true;
            n.receiveShadow = true;
          }
        });
        this._roomGroup.add(group);
        this._stripNonGeometryNodes(group);
        this._normalizeMaterials(group);
        this._applyMaterial(group, this._color, it);
        this._applyEdges(group);
        this._applyDoorVisibility(group);
        // 注：不再给每个柜体加内部点光源——小程序 WebGL 的 PointLight uniform 上限
        // 通常只 4–8 盏，多柜场景下叠加会让 shader 编译失败、整场景黑屏。
        this._cabinets.push({ mesh: group, item: it });
      }
      cursor += it.w / 2;
    }
  }

  _resolveModelPath(it) {
    const code = (it.code || '').toLowerCase();
    if (it.kind === 'standard' || it.kind === 'nonstandard') {
      const w = it.w >= 75 ? 100 : 50;
      let realCode = code;
      if (code === 'e1' || code === 'e2') realCode = 'a';
      const letter = realCode.charAt(0);
      return `/cabinet/utils/cabinet-model/${w}${letter.toUpperCase()}.glb`;
    }
    if (it.kind === 'corner') {
      if (code === 'y') return '/cabinet/utils/cabinet-model/Y-110-230.glb';
      if (code === 'z') return '/cabinet/utils/cabinet-model/Z-110-230.glb';
      return null;
    }
    if (code === 'yg') return '/cabinet/utils/cabinet-model/YG-110-230G1.glb';
    if (code === 'zg') return '/cabinet/utils/cabinet-model/ZG-110-230G1.glb';
    if (code === 'g' || code === 'g1' || code === 'g2') {
      const w = it.w >= 75 ? 100 : 50;
      const variant = code === 'g2' ? 'G2' : 'G1';
      return `/cabinet/utils/cabinet-model/${w}${variant}.glb`;
    }
    return null;
  }

  _loadItemMesh(it) {
    const THREE = this.THREE;
    if (it.kind === 'sk') {
      const geo = new THREE.BoxGeometry(it.w, it.h, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: COLOR_HEX[this._color] || COLOR_HEX.white,
        roughness: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = it.h / 2;
      const wrap = new THREE.Group();
      wrap.add(mesh);
      return Promise.resolve(wrap);
    }
    const path = this._resolveModelPath(it);
    if (!path) {
      return Promise.resolve(this._fallbackBox(it));
    }
    // 命中本 renderer 自己的 parse 缓存：走 root.clone(true)（renderer 内 geo/mat 共享安全）
    if (this._loaderCache[path]) {
      return Promise.resolve(this._loaderCache[path].clone(true));
    }
    return new Promise((resolve) => {
      this._readGlb(path)
        .then((buffer) => {
          if (!buffer) {
            console.warn('[3D] empty buffer', path);
            return resolve(this._fallbackBox(it));
          }
          try {
            this.gltfLoader.parse(
              buffer,
              '',
              (gltf) => {
                const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (!root) {
                  console.warn('[3D] parse: no scene', path);
                  return resolve(this._fallbackBox(it));
                }
                this._loaderCache[path] = root;
                console.log('[3D] glb loaded', path);
                resolve(root.clone(true));
              },
              (err) => {
                console.warn('[3D] parse failed', path, err && err.message);
                resolve(this._fallbackBox(it));
              }
            );
          } catch (e) {
            console.warn('[3D] parse threw', path, e && e.message);
            resolve(this._fallbackBox(it));
          }
        })
        .catch((err) => {
          console.warn('[3D] readGlb failed', path, err);
          resolve(this._fallbackBox(it));
        });
    });
  }

  // 优先用 wx.getFileSystemManager().readFile 读包内文件；
  // 失败时回退到 wx.request 请求本地（仅在开发者工具/部分环境有效）。
  // 模块级 buffer 缓存：同 path 跨 renderer 只读一次 disk。
  _readGlb(path) {
    if (GLB_BUFFER_CACHE[path]) {
      return Promise.resolve(GLB_BUFFER_CACHE[path]);
    }
    if (GLB_BUFFER_PROMISES[path]) {
      return GLB_BUFFER_PROMISES[path];
    }
    const promise = new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath: path,
        success: (res) => resolve(res.data),
        fail: (err) => {
          console.warn('[3D] readFile fail, try without leading slash', path, err && err.errMsg);
          // 部分基础库需要不带前导 /
          fs.readFile({
            filePath: path.replace(/^\//, ''),
            success: (res) => resolve(res.data),
            fail: (err2) => reject(err2),
          });
        },
      });
    });
    GLB_BUFFER_PROMISES[path] = promise;
    promise.then(
      (buf) => { GLB_BUFFER_CACHE[path] = buf; delete GLB_BUFFER_PROMISES[path]; },
      () => { delete GLB_BUFFER_PROMISES[path]; }
    );
    return promise;
  }

  _fallbackBox(it) {
    const THREE = this.THREE;
    const geo = new THREE.BoxGeometry(it.w, it.h, 60);
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_HEX[this._color] || COLOR_HEX.white,
      roughness: 0.6,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = it.h / 2;
    return m;
  }

  // 由 design 页注入：一块离屏 2d canvas，专门承接 readPixels 出来的像素再喂给
  // wx.canvasToTempFilePath。iOS 真机 canvasToTempFilePath 不能直接吃 webgl canvas
  // （它内部 getContext('2d') 会与已存在的 webgl 上下文冲突，报 Invalid context type [2d]）。
  setSnapshotCanvas(snapCanvas) {
    this._snapCanvas = snapCanvas || null;
  }

  // 读 webgl 后缓冲的像素，写到 2d 截图画布上（含 Y 翻转），再走 canvasToTempFilePath。
  // 要求当帧 render 已经同步执行过、且 WebGLRenderer 初始化时设了 preserveDrawingBuffer:true，
  // 否则像素已经被丢弃 / 不可读。返回 Promise<tempFilePath | null>。
  _snapshotToFile(quality) {
    const snap = this._snapCanvas;
    if (!snap) {
      console.warn('[3D] snapshot canvas not set, cannot capture');
      return Promise.resolve(null);
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return Promise.resolve(null);
    const gl = this.renderer.getContext && this.renderer.getContext();
    if (!gl) return Promise.resolve(null);
    const pixels = new Uint8Array(w * h * 4);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } catch (e) {
      console.warn('[3D] readPixels failed', e && e.message);
      return Promise.resolve(null);
    }
    try {
      snap.width = w;
      snap.height = h;
      const ctx = snap.getContext('2d');
      const imageData = ctx.createImageData(w, h);
      const dst = imageData.data;
      const rowLen = w * 4;
      // WebGL 像素是 bottom-up，2d canvas 是 top-down，按行翻转
      for (let y = 0; y < h; y++) {
        const srcOff = (h - 1 - y) * rowLen;
        const dstOff = y * rowLen;
        dst.set(pixels.subarray(srcOff, srcOff + rowLen), dstOff);
      }
      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      console.warn('[3D] snap blit failed', e && e.message);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      wx.canvasToTempFilePath({
        canvas: snap,
        fileType: 'jpg',
        quality: typeof quality === 'number' ? quality : 0.95,
        success: (res) => resolve(res && res.tempFilePath ? res.tempFilePath : null),
        fail: (err) => {
          console.warn('[3D] snap canvasToTempFilePath failed', err && err.errMsg);
          resolve(null);
        },
      });
    });
  }

  // 把当前主 3D 画面以 jpg 形式保存为微信临时文件，用于 materials 页布局预览。
  // 截图前临时把视角重置为正面 / zoom=1.5（"3D 空间正面、150%"），截完恢复用户原视角。
  // 返回 Promise<tempFilePath | null>。
  captureLayoutImage(quality) {
    if (!this.canvas || !this.renderer || !this.scene || !this.camera) {
      return Promise.resolve(null);
    }
    const savedRotX = this._rotX;
    const savedRotY = this._rotY;
    const savedZoom = this._zoom;
    const CAPTURE_ZOOM = 1.5;
    this._rotX = 0;
    this._rotY = 0;
    this._zoom = CAPTURE_ZOOM;
    try {
      if (this._roomGroup) {
        this._roomGroup.rotation.x = 0;
        this._roomGroup.rotation.y = 0;
      }
      this.camera.position.z = this._cameraDist / CAPTURE_ZOOM;
      this.camera.lookAt(0, this.wall.h / 2, 0);
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      console.warn('[3D] capture render failed', e && e.message);
    }
    const restore = () => {
      this._rotX = savedRotX;
      this._rotY = savedRotY;
      this._zoom = savedZoom;
    };
    return this._snapshotToFile(quality).then(
      (path) => { restore(); return path; },
      (err) => { restore(); console.warn('[3D] capture snapshot rejected', err); return null; }
    );
  }

  // 把当前主 3D 画面"去掉墙体/地板/顶板"后再截图，用作 materials 页的线框图。
  // _roomGroup 里直接挂的 Mesh 都是墙体/地/顶（柜体被包成 Group），临时 visible=false
  // 即可隐藏。背景换纯白（jpg 不支持透明）。视角同样正面 / zoom=1.5。
  captureWireframeImage(quality) {
    if (!this.canvas || !this.renderer || !this.scene || !this.camera || !this._roomGroup) {
      return Promise.resolve(null);
    }
    const savedRotX = this._rotX;
    const savedRotY = this._rotY;
    const savedZoom = this._zoom;
    const savedBg = this.scene.background;
    const CAPTURE_ZOOM = 1.5;
    const hidden = [];
    this._roomGroup.children.forEach((child) => {
      if (child.isMesh) {
        hidden.push(child);
        child.visible = false;
      }
    });
    try {
      this.scene.background = new this.THREE.Color(0xffffff);
    } catch (e) { /* ignore */ }
    this._rotX = 0;
    this._rotY = 0;
    this._zoom = CAPTURE_ZOOM;
    try {
      this._roomGroup.rotation.x = 0;
      this._roomGroup.rotation.y = 0;
      this.camera.position.z = this._cameraDist / CAPTURE_ZOOM;
      this.camera.lookAt(0, this.wall.h / 2, 0);
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      console.warn('[3D] wireframe capture render failed', e && e.message);
    }
    const restore = () => {
      hidden.forEach((m) => { m.visible = true; });
      this.scene.background = savedBg;
      this._rotX = savedRotX;
      this._rotY = savedRotY;
      this._zoom = savedZoom;
    };
    return this._snapshotToFile(quality).then(
      (path) => { restore(); return path; },
      (err) => { restore(); console.warn('[3D] wireframe snapshot rejected', err); return null; }
    );
  }

  dispose() {
    if (this._raf && this.canvas && this.canvas.cancelAnimationFrame) {
      this.canvas.cancelAnimationFrame(this._raf);
    }
    this._raf = null;
    // 不再遍历 scene 释放 geometry / material —— 它们是 cache 持有的共享资源，
    // 任何 renderer 调它们的 .dispose 都会触发跨 renderer 事件串扰
    // （表现为另一个 renderer 下一帧 setIndex 时 buffer info 已被清掉，
    // 抛 "Cannot read property 'type' of undefined"）。
    // GPU 端的 buffer / texture 由后续的 forceContextLoss 整体释放。
    if (this._envCube && this._envCube.dispose) {
      try { this._envCube.dispose(); } catch (e) { /* ignore */ }
    }
    // 2) 让 WebGLRenderer 释放它管的内部 buffer
    if (this.renderer && this.renderer.dispose) {
      try { this.renderer.dispose(); } catch (e) { /* ignore */ }
    }
    // 3) 关键：丢掉 WebGL context 给系统腾槽位（Chromium 上限默认 16）。
    //    优先用 three 的 forceContextLoss；不可用时手动取 WEBGL_lose_context 扩展。
    if (this.renderer && this.renderer.forceContextLoss) {
      try { this.renderer.forceContextLoss(); } catch (e) { /* ignore */ }
    } else if (this.renderer && this.renderer.getContext) {
      try {
        const gl = this.renderer.getContext();
        const ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (ext && ext.loseContext) ext.loseContext();
      } catch (e) { /* ignore */ }
    }
    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this._previewGroup = null;
    this._roomGroup = null;
    this._envCube = null;
    this._cabinets = [];
    this._loaderCache = {};
  }
}

module.exports = ThreeRenderer;
