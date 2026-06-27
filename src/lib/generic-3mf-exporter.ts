import JSZip from "jszip"
import * as THREE from "three"

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

/**
 * Builds a multi-plate Bambu Studio compatible 3MF file from an array of physical plates.
 */
export async function buildMultiPlate3MF(plates: PrintPlate[], options?: { printerModel?: string, groupIntoOneObject?: boolean }): Promise<Blob> {
  const zip = new JSZip()
  const TRAY_SIZE_X = options?.printerModel === 'a1_mini' ? 180 : 256
  const TRAY_SIZE_Y = options?.printerModel === 'a1_mini' ? 180 : 256

  // 1. Gather all unique colors for Bambu Studio <extruder> tags
  const uniqueColors: string[] = []
  for (const plate of plates) {
    for (const item of plate.items) {
      const hex = item.colorHex || "#CCCCCC"
      if (!uniqueColors.includes(hex)) {
        uniqueColors.push(hex)
      }
    }
  }

  const fmt = (n: number) => Number(n.toFixed(6))
  const generateUUID = () => crypto.randomUUID().toUpperCase()

  // 2. Build the main XML structures
  const objects: string[] = []
  const buildItems: string[] = []
  const modelSettingsObjects: string[] = []
  let nextObjectId = 1

  plates.forEach((plate, plateIdx) => {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    // First pass: Find bounding box of entire plate to auto-center it
    plate.items.forEach(item => {
      const geo = item.geometry.clone()
      if (item.transform) geo.applyMatrix4(item.transform)
      geo.computeBoundingBox()
      if (geo.boundingBox) {
        minX = Math.min(minX, geo.boundingBox.min.x)
        maxX = Math.max(maxX, geo.boundingBox.max.x)
        minY = Math.min(minY, geo.boundingBox.min.y)
        maxY = Math.max(maxY, geo.boundingBox.max.y)
      }
    })

    const cx = minX === Infinity ? 0 : (minX + maxX) / 2
    const cy = minY === Infinity ? 0 : (minY + maxY) / 2

    const groupIntoOneObject = options?.groupIntoOneObject !== false

    const componentXmls: string[] = []
    const partSettingsXmls: string[] = []
    const plateObjectIds: number[] = []

    plate.items.forEach((item) => {
      const templateId = nextObjectId++
      const cleanName = (item.name || "Object").replace(/[^a-zA-Z0-9_\- ]/g, "")
      const hex = item.colorHex || "#CCCCCC"
      const colorIndex = uniqueColors.indexOf(hex)
      const extruderIndex = colorIndex + 1

      const geo = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone()
      const pos = geo.getAttribute("position")
      const verts: string[] = []
      const tris: string[] = []

      for (let i = 0; i < pos.count; i++) {
        verts.push(`<vertex x="${fmt(pos.getX(i))}" y="${fmt(pos.getY(i))}" z="${fmt(pos.getZ(i))}"/>`)
      }

      for (let v = 0; v < pos.count; v += 3) {
        tris.push(`<triangle v1="${v}" v2="${v + 1}" v3="${v + 2}" pid="1" p1="${colorIndex}"/>`)
      }

      objects.push(
        `    <object id="${templateId}" type="model">\n` +
        `      <mesh>\n` +
        `        <vertices>${verts.join("")}</vertices>\n` +
        `        <triangles>${tris.join("")}</triangles>\n` +
        `      </mesh>\n` +
        `    </object>`
      )

      let tx = 0, ty = 0, tz = 0
      if (item.transform) {
        const elements = item.transform.elements
        tx = elements[12]
        ty = elements[13]
        tz = elements[14]
      }

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
        
        let row = Math.floor(plateIdx / 3)
        let col = plateIdx % 3
        const match = plate.name.match(/_R(\d+)_C(\d+)/)
        if (match) {
          row = parseInt(match[1], 10) - 1
          col = parseInt(match[2], 10) - 1
        }
        const PLATE_SPACING_X = TRAY_SIZE_X * 1.2
        const PLATE_SPACING_Y = TRAY_SIZE_Y * 1.2
        const globalX = col * PLATE_SPACING_X
        const globalY = -row * PLATE_SPACING_Y
        
        buildItems.push(`    <item objectid="${templateId}" p:UUID="${generateUUID()}" transform="1 0 0 0 1 0 0 0 1 ${fmt(globalX + TRAY_SIZE_X / 2 + item_tx)} ${fmt(globalY + TRAY_SIZE_Y / 2 + item_ty)} ${fmt(item_tz)}" printable="1"/>`)
        
        modelSettingsObjects.push(`
  <object id="${templateId}">
    <metadata key="name" value="${cleanName}"/>
    <metadata key="extruder" value="${extruderIndex}"/>
  </object>`)
      }
    })

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

      let row = Math.floor(plateIdx / 3)
      let col = plateIdx % 3
      const match = plate.name.match(/_R(\d+)_C(\d+)/)
      if (match) {
        row = parseInt(match[1], 10) - 1
        col = parseInt(match[2], 10) - 1
      }
      
      const PLATE_SPACING_X = TRAY_SIZE_X * 1.2
      const PLATE_SPACING_Y = TRAY_SIZE_Y * 1.2
      
      const globalX = col * PLATE_SPACING_X
      const globalY = -row * PLATE_SPACING_Y
      buildItems.push(`    <item objectid="${masterId}" p:UUID="${generateUUID()}" transform="1 0 0 0 1 0 0 0 1 ${globalX + TRAY_SIZE_X / 2} ${globalY + TRAY_SIZE_Y / 2} 0" printable="1"/>`)

      modelSettingsObjects.push(`
  <object id="${masterId}">
    <metadata key="name" value="${plate.name}"/>
${partSettingsXmls.join("\n")}
  </object>`)
    }
    
    // Store plateObjectIds into the plate object temporarily so we can access it during the plateConfigs loop
    (plate as any)._objectIds = plateObjectIds
  })

  const colorEntries = uniqueColors
    .map((c) => {
      const h = c.replace("#", "")
      const triplet = `#${h.padEnd(6, "0").slice(0, 6)}FF`.toUpperCase()
      return `      <m:color color="${triplet}"/>`
    })
    .join("\n")

  // 3. Assemble Bambu 3dmodel.model
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

  // 4. Assemble Bambu model_settings.config (Assigns extruders to objects)
  const plateConfigs = plates.map((plate, i) => {
    const objectIds: number[] = (plate as any)._objectIds || [];
    
    const instancesXml = objectIds.map(objId => `    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`).join("\n");

    return `
  <plate>
    <metadata key="plater_id" value="${i + 1}"/>
    <metadata key="plater_name" value="${(plate.name || "").replace(/[<>&"']/g, "")}"/>
${instancesXml}
  </plate>`;
  }).join("")

  const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>\n<config>${modelSettingsObjects.join("")}${plateConfigs}\n</config>`

  const colorsArray = uniqueColors.length > 0
    ? uniqueColors.map(c => {
      const hex = c.startsWith("#") ? c : `#${c}`
      return `${hex}FF`.toUpperCase()
    })
    : ["#CCCCCCFF"]

  // 5. ZIP it all up
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

  const { bambuProjectSettings } = await import("./bambu-project-settings");

  const baseConfig = JSON.parse(bambuProjectSettings);
  const originalCount = baseConfig.filament_colour.length;
  const newCount = Math.max(1, colorsArray.length);

  for (const key of Object.keys(baseConfig)) {
    if (Array.isArray(baseConfig[key]) && baseConfig[key].length === originalCount) {
      if (newCount <= originalCount) {
        baseConfig[key] = baseConfig[key].slice(0, newCount);
      } else {
        const arr = [...baseConfig[key]];
        while (arr.length < newCount) {
          arr.push(arr[0]);
        }
        baseConfig[key] = arr;
      }
    }
  }

  if (options?.printerModel === 'a1_mini') {
    baseConfig["printer_model"] = "Bambu Lab A1 mini"
    baseConfig["printer_settings_id"] = "Bambu Lab A1 mini 0.4 nozzle"
    baseConfig["default_print_profile"] = "0.20mm Standard @BBL A1M"
  } else {
    baseConfig["printer_model"] = "Bambu Lab A1"
    baseConfig["printer_settings_id"] = "Bambu Lab A1 0.4 nozzle"
    baseConfig["default_print_profile"] = "0.20mm Standard @BBL A1"
  }

  baseConfig.filament_colour = colorsArray;
  baseConfig.filament_map = uniqueColors.map((_, i) => (i + 1).toString());

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

  return zip.generateAsync({ type: "blob" })
}

