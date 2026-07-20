import JSZip from "jszip"
import * as THREE from "three"
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js"
import {
  EXPORT_3MF_VERTEX_CHUNK,
  throwIfExportAborted,
  yieldExportThread,
} from "./export-constants"

export interface PrintItem {
  geometry: THREE.BufferGeometry // MUST have normals and position attributes!
  colorHex?: string // e.g., "#FF0000"
  name?: string
  transform?: THREE.Matrix4 // Optional absolute transform
}

export interface PrintPlate {
  name: string
  items: PrintItem[]
  centerX?: number
  centerY?: number
}

export interface BuildMultiPlate3MFOptions {
  printerModel?: string
  groupIntoOneObject?: boolean
  onProgress?: (msg: string) => void
  signal?: AbortSignal
}

const fmt = (n: number) => Number(n.toFixed(6))
const generateUUID = () => crypto.randomUUID().toUpperCase()

function getUniqueColors(plates: PrintPlate[]): string[] {
  const uniqueColors: string[] = []
  for (const plate of plates) {
    for (const item of plate.items) {
      const hex = item.colorHex || "#CCCCCC"
      if (!uniqueColors.includes(hex)) {
        uniqueColors.push(hex)
      }
    }
  }
  return uniqueColors
}

function computePlateCenter(plate: PrintPlate): { cx: number, cy: number } {
  const box = new THREE.Box3()
  let hasBounds = false

  plate.items.forEach(item => {
    const geo = item.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    if (!geo.boundingBox) return
    const itemBox = geo.boundingBox.clone()
    if (item.transform) itemBox.applyMatrix4(item.transform)
    if (!hasBounds) {
      box.copy(itemBox)
      hasBounds = true
    } else {
      box.union(itemBox)
    }
  })

  if (!hasBounds) return { cx: 0, cy: 0 }
  const center = new THREE.Vector3()
  box.getCenter(center)
  return { cx: center.x, cy: center.y }
}

function prepareGeometryFor3mf(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  // Keep indexed Manifold meshes; only weld if non-indexed. Avoid toNonIndexed
  // which re-splits verts and fights watertight topology.
  let g = geo.clone()
  if (!g.index) {
    g = BufferGeometryUtils.mergeVertices(g, 1e-3)
  }
  if (!g.getAttribute('normal')) {
    g.computeVertexNormals()
  }

  const pos = g.getAttribute("position")
  let index = g.getIndex()

  if (!index && pos) {
    const triCount = Math.floor(pos.count / 3)
    const idx = new Uint32Array(triCount * 3)
    for (let i = 0; i < triCount * 3; i++) idx[i] = i
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    index = g.getIndex()
  }

  return g
}

async function generateMeshObjectXml(
  item: PrintItem,
  templateId: number,
  colorIndex: number,
  meshLabel: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
): Promise<string> {
  throwIfExportAborted(signal)
  const geo = prepareGeometryFor3mf(item.geometry)
  const pos = geo.getAttribute("position")
  const index = geo.getIndex()
  if (!pos || !index) {
    throw new Error(`Invalid geometry for 3MF export: ${meshLabel}`)
  }

  const vertChunks: string[] = []
  for (let start = 0; start < pos.count; start += EXPORT_3MF_VERTEX_CHUNK) {
    throwIfExportAborted(signal)
    const end = Math.min(start + EXPORT_3MF_VERTEX_CHUNK, pos.count)
    let chunk = ""
    for (let i = start; i < end; i++) {
      chunk += `<vertex x="${fmt(pos.getX(i))}" y="${fmt(pos.getY(i))}" z="${fmt(pos.getZ(i))}"/>`
    }
    vertChunks.push(chunk)
    if (onProgress && (end === pos.count || end % (EXPORT_3MF_VERTEX_CHUNK * 5) === 0)) {
      onProgress(`Writing ${meshLabel}: ${end.toLocaleString()} / ${pos.count.toLocaleString()} vertices...`)
    }
    if (start > 0 && start % (EXPORT_3MF_VERTEX_CHUNK * 5) === 0) {
      await yieldExportThread()
    }
  }

  const triChunks: string[] = []
  // Chunk by whole triangles only — raw index strides not divisible by 3 misalign
  // later chunks (e.g. 50000 % 3 === 2) and corrupt mesh connectivity in Bambu.
  const TRI_CHUNK_TRIS = 16_666
  const triCount = Math.floor(index.count / 3)
  for (let tri0 = 0; tri0 < triCount; tri0 += TRI_CHUNK_TRIS) {
    throwIfExportAborted(signal)
    const triEnd = Math.min(tri0 + TRI_CHUNK_TRIS, triCount)
    let chunk = ""
    for (let tri = tri0; tri < triEnd; tri++) {
      const t = tri * 3
      chunk += `<triangle v1="${index.getX(t)}" v2="${index.getX(t + 1)}" v3="${index.getX(t + 2)}" pid="1" p1="${colorIndex}"/>`
    }
    triChunks.push(chunk)
    if (tri0 > 0 && tri0 % (TRI_CHUNK_TRIS * 2) === 0) {
      await yieldExportThread()
    }
  }

  return `    <object id="${templateId}" type="model">\n` +
         `      <mesh>\n` +
         `        <vertices>${vertChunks.join("")}</vertices>\n` +
         `        <triangles>${triChunks.join("")}</triangles>\n` +
         `      </mesh>\n` +
         `    </object>`
}

async function getBambuProjectSettings(
  colorsArray: string[],
  uniqueColors: string[],
  printerModel?: string
) {
  const { bambuProjectSettings } = await import("./bambu-project-settings")

  const baseConfig = JSON.parse(bambuProjectSettings)
  const originalCount = baseConfig.filament_colour.length
  const newCount = Math.max(1, colorsArray.length)

  for (const key of Object.keys(baseConfig)) {
    if (Array.isArray(baseConfig[key]) && baseConfig[key].length === originalCount) {
      if (newCount <= originalCount) {
        baseConfig[key] = baseConfig[key].slice(0, newCount)
      } else {
        const arr = [...baseConfig[key]]
        while (arr.length < newCount) {
          arr.push(arr[0])
        }
        baseConfig[key] = arr
      }
    }
  }

  if (printerModel === 'a1_mini') {
    baseConfig["printer_model"] = "Bambu Lab A1 mini"
    baseConfig["printer_settings_id"] = "Bambu Lab A1 mini 0.4 nozzle"
    baseConfig["default_print_profile"] = "0.20mm Standard @BBL A1M"
  } else {
    baseConfig["printer_model"] = "Bambu Lab A1"
    baseConfig["printer_settings_id"] = "Bambu Lab A1 0.4 nozzle"
    baseConfig["default_print_profile"] = "0.20mm Standard @BBL A1"
  }

  baseConfig.filament_colour = colorsArray
  baseConfig.filament_map = uniqueColors.map((_, i) => (i + 1).toString())

  return baseConfig
}

function getColorsArray(uniqueColors: string[]): string[] {
  return uniqueColors.length > 0
    ? uniqueColors.map(c => {
      const hex = c.startsWith("#") ? c : `#${c}`
      return `${hex}FF`.toUpperCase()
    })
    : ["#CCCCCCFF"]
}

function getColorEntriesXml(uniqueColors: string[]): string {
  return uniqueColors
    .map((c) => {
      const h = c.replace("#", "")
      const triplet = `#${h.padEnd(6, "0").slice(0, 6)}FF`.toUpperCase()
      return `      <m:color color="${triplet}"/>`
    })
    .join("\n")
}

function generatePlateConfigsXml(plates: PrintPlate[]): string {
  return plates.map((plate, i) => {
    const objectIds: number[] = (plate as any)._objectIds || []
    
    const instancesXml = objectIds.map(objId => `    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`).join("\n")

    return `
  <plate>
    <metadata key="plater_id" value="${i + 1}"/>
    <metadata key="plater_name" value="${(plate.name || "").replace(/[<>&"']/g, "")}"/>
${instancesXml}
  </plate>`
  }).join("")
}

function getPlateRowCol(plateName: string, plateIdx: number) {
  let row = Math.floor(plateIdx / 3)
  let col = plateIdx % 3
  const match = plateName.match(/_R(\d+)_C(\d+)/)
  if (match) {
    row = parseInt(match[1], 10) - 1
    col = parseInt(match[2], 10) - 1
  }
  return { row, col }
}

function getTransformOffset(item: PrintItem) {
  if (item.transform) {
    const elements = item.transform.elements
    return { tx: elements[12], ty: elements[13], tz: elements[14] }
  }
  return { tx: 0, ty: 0, tz: 0 }
}

async function processPlates(
  plates: PrintPlate[], 
  uniqueColors: string[],
  groupIntoOneObject: boolean,
  TRAY_SIZE_X: number,
  TRAY_SIZE_Y: number,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
) {
  const objects: string[] = []
  const buildItems: string[] = []
  const modelSettingsObjects: string[] = []
  let nextObjectId = 1

  let totalMeshes = 0
  plates.forEach(p => { totalMeshes += p.items.length })
  let meshIndex = 0

  for (let plateIdx = 0; plateIdx < plates.length; plateIdx++) {
    const plate = plates[plateIdx]
    throwIfExportAborted(signal)
    const { cx, cy } = computePlateCenter(plate)
    const { row, col } = getPlateRowCol(plate.name, plateIdx)

    const PLATE_SPACING_X = TRAY_SIZE_X * 1.2
    const PLATE_SPACING_Y = TRAY_SIZE_Y * 1.2
    const globalX = col * PLATE_SPACING_X
    const globalY = -row * PLATE_SPACING_Y

    const componentXmls: string[] = []
    const partSettingsXmls: string[] = []
    const plateObjectIds: number[] = []

    for (const item of plate.items) {
      meshIndex++
      const templateId = nextObjectId++
      const cleanName = (item.name || "Object").replace(/[^a-zA-Z0-9_\- ]/g, "")
      const hex = item.colorHex || "#CCCCCC"
      const colorIndex = uniqueColors.indexOf(hex)
      const extruderIndex = colorIndex + 1
      const meshLabel = `mesh ${meshIndex}/${totalMeshes}`

      if (onProgress) {
        onProgress(`Building 3MF ${meshLabel}...`)
      }

      objects.push(await generateMeshObjectXml(
        item, templateId, colorIndex, meshLabel, onProgress, signal
      ))

      const { tx, ty, tz } = getTransformOffset(item)

      const item_tx = tx - cx
      const item_ty = ty - cy
      const item_tz = tz

      if (groupIntoOneObject) {
        componentXmls.push(`        <component objectid="${templateId}" transform="1 0 0 0 1 0 0 0 1 ${fmt(item_tx)} ${fmt(item_ty)} ${fmt(item_tz)}"/>`)
        partSettingsXmls.push(`    <part id="${templateId}" subtype="normal_part">
      <metadata key="name" value="${cleanName}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${extruderIndex}"/>
    </part>`)
      } else {
        plateObjectIds.push(templateId)
        
        buildItems.push(`    <item objectid="${templateId}" p:UUID="${generateUUID()}" transform="1 0 0 0 1 0 0 0 1 ${fmt(globalX + TRAY_SIZE_X / 2 + item_tx)} ${fmt(globalY + TRAY_SIZE_Y / 2 + item_ty)} ${fmt(item_tz)}" printable="1"/>`)
        
        modelSettingsObjects.push(`
  <object id="${templateId}">
    <metadata key="name" value="${cleanName}"/>
    <metadata key="extruder" value="${extruderIndex}"/>
  </object>`)
      }
    }

    if (groupIntoOneObject && componentXmls.length > 0) {
      const masterId = nextObjectId++
      plateObjectIds.push(masterId)

      objects.push(
        `    <object id="${masterId}" p:UUID="${generateUUID()}" type="model">\n` +
        `      <components>\n` +
        componentXmls.join("\n") +
        `\n      </components>\n` +
        `    </object>`
      )
      
      buildItems.push(`    <item objectid="${masterId}" p:UUID="${generateUUID()}" transform="1 0 0 0 1 0 0 0 1 ${globalX + TRAY_SIZE_X / 2} ${globalY + TRAY_SIZE_Y / 2} 0" printable="1"/>`)

      modelSettingsObjects.push(`
  <object id="${masterId}">
    <metadata key="name" value="${plate.name}"/>
${partSettingsXmls.join("\n")}
  </object>`)
    }
    
    ;(plate as any)._objectIds = plateObjectIds
  }
  
  return { objects, buildItems, modelSettingsObjects }
}

/**
 * Builds a multi-plate Bambu Studio compatible 3MF file from an array of physical plates.
 */
export async function buildMultiPlate3MF(
  plates: PrintPlate[],
  options?: BuildMultiPlate3MFOptions
): Promise<Blob> {
  const zip = new JSZip()
  const TRAY_SIZE_X = options?.printerModel === 'a1_mini' ? 180 : 256
  const TRAY_SIZE_Y = options?.printerModel === 'a1_mini' ? 180 : 256
  const onProgress = options?.onProgress
  const signal = options?.signal

  throwIfExportAborted(signal)
  const uniqueColors = getUniqueColors(plates)
  const groupIntoOneObject = options?.groupIntoOneObject !== false

  if (onProgress) onProgress("Writing 3MF mesh data...")
  const { objects, buildItems, modelSettingsObjects } = await processPlates(
    plates, uniqueColors, groupIntoOneObject, TRAY_SIZE_X, TRAY_SIZE_Y, onProgress, signal
  )

  throwIfExportAborted(signal)
  if (onProgress) onProgress("Packaging 3MF archive...")

  const colorEntries = getColorEntriesXml(uniqueColors)

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.bambulab.com/package/2021" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="p">
  <metadata name="Application">BambuStudio-02.06.00.51</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <resources>
    <m:colorgroup id="1">
${colorEntries}
    </m:colorgroup>
${objects.join("\n")}
  </resources>
  <build>
${buildItems.join("\n")}
  </build>
</model>`

  const plateConfigs = generatePlateConfigsXml(plates)
  const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>\n<config>${modelSettingsObjects.join("")}${plateConfigs}\n</config>`

  const colorsArray = getColorsArray(uniqueColors)

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
  <Relationship Target="/Metadata/model_settings.config" Id="rel-2" Type="http://schemas.bambulab.com/package/2021/model_settings"/>
  <Relationship Target="/Metadata/project_settings.config" Id="rel-3" Type="http://schemas.bambulab.com/package/2021/project_settings"/>
  <Relationship Target="/Metadata/slice_info.config" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/slice_info"/>
</Relationships>`
  )

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
</Types>`
  )

  const baseConfig = await getBambuProjectSettings(colorsArray, uniqueColors, options?.printerModel)

  zip.file("3D/3dmodel.model", modelXml)
  zip.file("Metadata/model_settings.config", modelSettingsXml)
  zip.file("Metadata/project_settings.config", JSON.stringify(baseConfig, null, 2))
  zip.file("Metadata/slice_info.config", `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.06.00.51"/>
  </header>
</config>`)

  if (onProgress) onProgress("Compressing 3MF...")
  await yieldExportThread()
  throwIfExportAborted(signal)

  return zip.generateAsync({ 
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  })
}
