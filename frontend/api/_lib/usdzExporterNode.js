// Node-compatible port of three.js examples/jsm/exporters/USDZExporter.js.
//
// The upstream exporter's only non-portable step is texture re-encoding: it
// calls `document.createElement('canvas')` + `canvas.toBlob('image/png')`,
// which requires a browser (or a native `canvas` binary + jsdom shim, which
// is fragile to deploy on serverless). node-three-gltf's loaders already
// decode every texture into a plain `{ data, width, height, channels }` raw
// RGBA buffer via `sharp` (not an HTMLImageElement/Canvas), so this port
// swaps imageToCanvas+toBlob for feeding that raw buffer straight back into
// `sharp` to resize/flip/re-encode as PNG. Everything else — the USD string
// builders — is kept verbatim, since that part is pure string/geometry code
// with no DOM dependency at all.
import { NoColorSpace, DoubleSide } from 'three';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';

export class USDZExporterNode {
  async parseAsync(scene, options = {}) {
    options = Object.assign(
      {
        ar: {
          anchoring: { type: 'plane' },
          planeAnchoring: { alignment: 'horizontal' },
        },
        quickLookCompatible: true,
        maxTextureSize: 1024,
      },
      options
    );

    const files = {};
    const modelFileName = 'model.usda';
    files[modelFileName] = null;

    let output = buildHeader();
    output += buildSceneStart(options);

    const materials = {};
    const textures = {};

    scene.traverseVisible((object) => {
      if (object.isMesh) {
        const geometry = object.geometry;
        const material = object.material;

        if (material.isMeshStandardMaterial) {
          const geometryFileName = 'geometries/Geometry_' + geometry.id + '.usda';

          if (!(geometryFileName in files)) {
            const meshObject = buildMeshObject(geometry);
            files[geometryFileName] = buildUSDFileAsString(meshObject);
          }

          if (!(material.uuid in materials)) {
            materials[material.uuid] = material;
          }

          output += buildXform(object, geometry, material);
        } else {
          console.warn(
            'USDZExporterNode: Unsupported material type (USDZ only supports MeshStandardMaterial)',
            object
          );
        }
      } else if (object.isCamera) {
        output += buildCamera(object);
      }
    });

    output += buildSceneEnd();
    output += buildMaterials(materials, textures, options.quickLookCompatible);

    files[modelFileName] = strToU8(output);
    output = null;

    for (const id in textures) {
      const texture = textures[id];
      const pngBuffer = await sharpImageToPngBuffer(texture, options.maxTextureSize);
      files[`textures/Texture_${id}.png`] = pngBuffer;
    }

    // 64 byte alignment
    // https://github.com/101arrowz/fflate/issues/39#issuecomment-777263109
    let offset = 0;

    for (const filename in files) {
      const file = files[filename];
      const headerSize = 34 + filename.length;
      offset += headerSize;

      const offsetMod64 = offset & 63;

      if (offsetMod64 !== 4) {
        const padLength = 64 - offsetMod64;
        const padding = new Uint8Array(padLength);
        files[filename] = [file, { extra: { 12345: padding } }];
      }

      offset = file.length;
    }

    return zipSync(files, { level: 0 });
  }
}

async function sharpImageToPngBuffer(texture, maxTextureSize) {
  const image = texture.image;

  // node-three-gltf's ImageLoader/TextureLoader decode into a plain
  // { data, width, height, channels } raw-pixel object (a resolved sharp()
  // read, not a live Sharp instance/HTMLImageElement/Canvas) — feed it back
  // into sharp as a raw buffer to resize/flip/re-encode.
  if (!image || !image.data || !image.width || !image.height) {
    throw new Error('USDZExporterNode: texture.image is not the expected {data,width,height,channels} object — unexpected loader output.');
  }

  const { data, width, height, channels } = image;
  const scale = maxTextureSize / Math.max(width, height);
  const targetW = Math.max(1, Math.round(width * Math.min(1, scale)));
  const targetH = Math.max(1, Math.round(height * Math.min(1, scale)));

  let pipeline = sharp(data, { raw: { width, height, channels } }).resize(targetW, targetH);

  if (texture.flipY === true) {
    pipeline = pipeline.flip();
  }

  return pipeline.png().toBuffer();
}

// ---- Everything below is copied verbatim (string/geometry builders only,
// no DOM dependency) from three.js's USDZExporter.js ----

const PRECISION = 7;

function buildHeader() {
  return `#usda 1.0
(
\tcustomLayerData = {
\t\tstring creator = "node-three-gltf USDZExporterNode"
\t}
\tdefaultPrim = "Root"
\tmetersPerUnit = 1
\tupAxis = "Y"
)

`;
}

function buildSceneStart(options) {
  return `def Xform "Root"
{
\tdef Scope "Scenes" (
\t\tkind = "sceneLibrary"
\t)
\t{
\t\tdef Xform "Scene" (
\t\t\tcustomData = {
\t\t\t\tbool preliminary_collidesWithEnvironment = 0
\t\t\t\tstring sceneName = "Scene"
\t\t\t}
\t\t\tsceneName = "Scene"
\t\t)
\t\t{
\t\ttoken preliminary:anchoring:type = "${options.ar.anchoring.type}"
\t\ttoken preliminary:planeAnchoring:alignment = "${options.ar.planeAnchoring.alignment}"

`;
}

function buildSceneEnd() {
  return `
\t\t}
\t}
}

`;
}

function buildUSDFileAsString(dataToInsert) {
  let output = buildHeader();
  output += dataToInsert;
  return strToU8(output);
}

function buildXform(object, geometry, material) {
  const name = 'Object_' + object.id;
  const transform = buildMatrix(object.matrixWorld);

  if (object.matrixWorld.determinant() < 0) {
    console.warn('USDZExporterNode: USDZ does not support negative scales', object);
  }

  return `def Xform "${name}" (
\tprepend references = @./geometries/Geometry_${geometry.id}.usda@</Geometry>
\tprepend apiSchemas = ["MaterialBindingAPI"]
)
{
\tmatrix4d xformOp:transform = ${transform}
\tuniform token[] xformOpOrder = ["xformOp:transform"]

\trel material:binding = </Materials/Material_${material.id}>
}

`;
}

function buildMatrix(matrix) {
  const array = matrix.elements;
  return `( ${buildMatrixRow(array, 0)}, ${buildMatrixRow(array, 4)}, ${buildMatrixRow(array, 8)}, ${buildMatrixRow(array, 12)} )`;
}

function buildMatrixRow(array, offset) {
  return `(${array[offset + 0]}, ${array[offset + 1]}, ${array[offset + 2]}, ${array[offset + 3]})`;
}

function buildMeshObject(geometry) {
  const mesh = buildMesh(geometry);
  return `
def "Geometry"
{
${mesh}
}
`;
}

function buildMesh(geometry) {
  const name = 'Geometry';
  const attributes = geometry.attributes;
  const count = attributes.position.count;

  return `
\tdef Mesh "${name}"
\t{
\t\tint[] faceVertexCounts = [${buildMeshVertexCount(geometry)}]
\t\tint[] faceVertexIndices = [${buildMeshVertexIndices(geometry)}]
\t\tnormal3f[] normals = [${buildVector3Array(attributes.normal, count)}] (
\t\t\tinterpolation = "vertex"
\t\t)
\t\tpoint3f[] points = [${buildVector3Array(attributes.position, count)}]
${buildPrimvars(attributes)}
\t\tuniform token subdivisionScheme = "none"
\t}
`;
}

function buildMeshVertexCount(geometry) {
  const count = geometry.index !== null ? geometry.index.count : geometry.attributes.position.count;
  return Array(count / 3).fill(3).join(', ');
}

function buildMeshVertexIndices(geometry) {
  const index = geometry.index;
  const array = [];

  if (index !== null) {
    for (let i = 0; i < index.count; i++) {
      array.push(index.getX(i));
    }
  } else {
    const length = geometry.attributes.position.count;
    for (let i = 0; i < length; i++) {
      array.push(i);
    }
  }

  return array.join(', ');
}

function buildVector3Array(attribute, count) {
  if (attribute === undefined) {
    console.warn('USDZExporterNode: Normals missing.');
    return Array(count).fill('(0, 0, 0)').join(', ');
  }

  const array = [];
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i);
    const y = attribute.getY(i);
    const z = attribute.getZ(i);
    array.push(`(${x.toPrecision(PRECISION)}, ${y.toPrecision(PRECISION)}, ${z.toPrecision(PRECISION)})`);
  }

  return array.join(', ');
}

function buildVector2Array(attribute) {
  const array = [];
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i);
    const y = attribute.getY(i);
    array.push(`(${x.toPrecision(PRECISION)}, ${(1 - y).toPrecision(PRECISION)})`);
  }

  return array.join(', ');
}

function buildPrimvars(attributes) {
  let string = '';

  for (let i = 0; i < 4; i++) {
    const id = i > 0 ? i : '';
    const attribute = attributes['uv' + id];

    if (attribute !== undefined) {
      string += `
\t\ttexCoord2f[] primvars:st${id} = [${buildVector2Array(attribute)}] (
\t\t\tinterpolation = "vertex"
\t\t)`;
    }
  }

  const colorAttribute = attributes.color;

  if (colorAttribute !== undefined) {
    const count = colorAttribute.count;
    string += `
\tcolor3f[] primvars:displayColor = [${buildVector3Array(colorAttribute, count)}] (
\t\tinterpolation = "vertex"
\t\t)`;
  }

  return string;
}

function buildMaterials(materials, textures, quickLookCompatible = false) {
  const array = [];

  for (const uuid in materials) {
    const material = materials[uuid];
    array.push(buildMaterial(material, textures, quickLookCompatible));
  }

  return `def "Materials"
{
${array.join('')}
}

`;
}

function buildMaterial(material, textures, quickLookCompatible = false) {
  const pad = '\t\t\t';
  const inputs = [];
  const samplers = [];

  function buildTexture(texture, mapType, color) {
    const id = texture.source.id + '_' + texture.flipY;
    textures[id] = texture;

    const uv = texture.channel > 0 ? 'st' + texture.channel : 'st';

    const WRAPPINGS = {
      1000: 'repeat',
      1001: 'clamp',
      1002: 'mirror',
    };

    const repeat = texture.repeat.clone();
    const offset = texture.offset.clone();
    const rotation = texture.rotation;

    const xRotationOffset = Math.sin(rotation);
    const yRotationOffset = Math.cos(rotation);

    offset.y = 1 - offset.y - repeat.y;

    if (quickLookCompatible) {
      offset.x = offset.x / repeat.x;
      offset.y = offset.y / repeat.y;
      offset.x += xRotationOffset / repeat.x;
      offset.y += yRotationOffset - 1;
    } else {
      offset.x += xRotationOffset * repeat.x;
      offset.y += (1 - yRotationOffset) * repeat.y;
    }

    return `
\t\tdef Shader "PrimvarReader_${mapType}"
\t\t{
\t\t\tuniform token info:id = "UsdPrimvarReader_float2"
\t\t\tfloat2 inputs:fallback = (0.0, 0.0)
\t\t\ttoken inputs:varname = "${uv}"
\t\t\tfloat2 outputs:result
\t\t}

\t\tdef Shader "Transform2d_${mapType}"
\t\t{
\t\t\tuniform token info:id = "UsdTransform2d"
\t\t\ttoken inputs:in.connect = </Materials/Material_${material.id}/PrimvarReader_${mapType}.outputs:result>
\t\t\tfloat inputs:rotation = ${(rotation * (180 / Math.PI)).toFixed(PRECISION)}
\t\t\tfloat2 inputs:scale = ${buildVector2(repeat)}
\t\t\tfloat2 inputs:translation = ${buildVector2(offset)}
\t\t\tfloat2 outputs:result
\t\t}

\t\tdef Shader "Texture_${texture.id}_${mapType}"
\t\t{
\t\t\tuniform token info:id = "UsdUVTexture"
\t\t\tasset inputs:file = @textures/Texture_${id}.png@
\t\t\tfloat2 inputs:st.connect = </Materials/Material_${material.id}/Transform2d_${mapType}.outputs:result>
\t\t\t${color !== undefined ? 'float4 inputs:scale = ' + buildColor4(color) : ''}
\t\t\ttoken inputs:sourceColorSpace = "${texture.colorSpace === NoColorSpace ? 'raw' : 'sRGB'}"
\t\t\ttoken inputs:wrapS = "${WRAPPINGS[texture.wrapS]}"
\t\t\ttoken inputs:wrapT = "${WRAPPINGS[texture.wrapT]}"
\t\t\tfloat outputs:r
\t\t\tfloat outputs:g
\t\t\tfloat outputs:b
\t\t\tfloat3 outputs:rgb
\t\t\t${material.transparent || material.alphaTest > 0.0 ? 'float outputs:a' : ''}
\t\t}`;
  }

  if (material.side === DoubleSide) {
    console.warn('USDZExporterNode: USDZ does not support double sided materials', material);
  }

  if (material.map !== null) {
    inputs.push(`${pad}color3f inputs:diffuseColor.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:rgb>`);

    if (material.transparent) {
      inputs.push(`${pad}float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:a>`);
    } else if (material.alphaTest > 0.0) {
      inputs.push(`${pad}float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.map.id}_diffuse.outputs:a>`);
      inputs.push(`${pad}float inputs:opacityThreshold = ${material.alphaTest}`);
    }

    samplers.push(buildTexture(material.map, 'diffuse', material.color));
  } else {
    inputs.push(`${pad}color3f inputs:diffuseColor = ${buildColor(material.color)}`);
  }

  if (material.emissiveMap !== null) {
    inputs.push(`${pad}color3f inputs:emissiveColor.connect = </Materials/Material_${material.id}/Texture_${material.emissiveMap.id}_emissive.outputs:rgb>`);
    samplers.push(buildTexture(material.emissiveMap, 'emissive'));
  } else if (material.emissive.getHex() > 0) {
    inputs.push(`${pad}color3f inputs:emissiveColor = ${buildColor(material.emissive)}`);
  }

  if (material.normalMap !== null) {
    inputs.push(`${pad}normal3f inputs:normal.connect = </Materials/Material_${material.id}/Texture_${material.normalMap.id}_normal.outputs:rgb>`);
    samplers.push(buildTexture(material.normalMap, 'normal'));
  }

  if (material.aoMap !== null) {
    inputs.push(`${pad}float inputs:occlusion.connect = </Materials/Material_${material.id}/Texture_${material.aoMap.id}_occlusion.outputs:r>`);
    samplers.push(buildTexture(material.aoMap, 'occlusion'));
  }

  if (material.roughnessMap !== null && material.roughness === 1) {
    inputs.push(`${pad}float inputs:roughness.connect = </Materials/Material_${material.id}/Texture_${material.roughnessMap.id}_roughness.outputs:g>`);
    samplers.push(buildTexture(material.roughnessMap, 'roughness'));
  } else {
    inputs.push(`${pad}float inputs:roughness = ${material.roughness}`);
  }

  if (material.metalnessMap !== null && material.metalness === 1) {
    inputs.push(`${pad}float inputs:metallic.connect = </Materials/Material_${material.id}/Texture_${material.metalnessMap.id}_metallic.outputs:b>`);
    samplers.push(buildTexture(material.metalnessMap, 'metallic'));
  } else {
    inputs.push(`${pad}float inputs:metallic = ${material.metalness}`);
  }

  if (material.alphaMap !== null) {
    inputs.push(`${pad}float inputs:opacity.connect = </Materials/Material_${material.id}/Texture_${material.alphaMap.id}_opacity.outputs:r>`);
    inputs.push(`${pad}float inputs:opacityThreshold = 0.0001`);
    samplers.push(buildTexture(material.alphaMap, 'opacity'));
  } else {
    inputs.push(`${pad}float inputs:opacity = ${material.opacity}`);
  }

  if (material.isMeshPhysicalMaterial) {
    inputs.push(`${pad}float inputs:clearcoat = ${material.clearcoat}`);
    inputs.push(`${pad}float inputs:clearcoatRoughness = ${material.clearcoatRoughness}`);
    inputs.push(`${pad}float inputs:ior = ${material.ior}`);
  }

  return `
\tdef Material "Material_${material.id}"
\t{
\t\tdef Shader "PreviewSurface"
\t\t{
\t\t\tuniform token info:id = "UsdPreviewSurface"
${inputs.join('\n')}
\t\t\tint inputs:useSpecularWorkflow = 0
\t\t\ttoken outputs:surface
\t\t}

\t\ttoken outputs:surface.connect = </Materials/Material_${material.id}/PreviewSurface.outputs:surface>

${samplers.join('\n')}

\t}
`;
}

function buildColor(color) {
  return `(${color.r}, ${color.g}, ${color.b})`;
}

function buildColor4(color) {
  return `(${color.r}, ${color.g}, ${color.b}, 1.0)`;
}

function buildVector2(vector) {
  return `(${vector.x}, ${vector.y})`;
}

function buildCamera(camera) {
  const name = camera.name ? camera.name : 'Camera_' + camera.id;
  const transform = buildMatrix(camera.matrixWorld);

  if (camera.matrixWorld.determinant() < 0) {
    console.warn('USDZExporterNode: USDZ does not support negative scales', camera);
  }

  if (camera.isOrthographicCamera) {
    return `def Camera "${name}"
\t\t{
\t\t\tmatrix4d xformOp:transform = ${transform}
\t\t\tuniform token[] xformOpOrder = ["xformOp:transform"]

\t\t\tfloat2 clippingRange = (${camera.near.toPrecision(PRECISION)}, ${camera.far.toPrecision(PRECISION)})
\t\t\tfloat horizontalAperture = ${((Math.abs(camera.left) + Math.abs(camera.right)) * 10).toPrecision(PRECISION)}
\t\t\tfloat verticalAperture = ${((Math.abs(camera.top) + Math.abs(camera.bottom)) * 10).toPrecision(PRECISION)}
\t\t\ttoken projection = "orthographic"
\t\t}

`;
  } else {
    return `def Camera "${name}"
\t\t{
\t\t\tmatrix4d xformOp:transform = ${transform}
\t\t\tuniform token[] xformOpOrder = ["xformOp:transform"]

\t\t\tfloat2 clippingRange = (${camera.near.toPrecision(PRECISION)}, ${camera.far.toPrecision(PRECISION)})
\t\t\tfloat focalLength = ${camera.getFocalLength().toPrecision(PRECISION)}
\t\t\tfloat focusDistance = ${camera.focus.toPrecision(PRECISION)}
\t\t\tfloat horizontalAperture = ${camera.getFilmWidth().toPrecision(PRECISION)}
\t\t\ttoken projection = "perspective"
\t\t\tfloat verticalAperture = ${camera.getFilmHeight().toPrecision(PRECISION)}
\t\t}

`;
  }
}
