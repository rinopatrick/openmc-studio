import type {
  AssemblyType,
  ComponentRegistry,
  CoreLayout,
  EnergyUnit,
  MaterialDefinition,
  PinCellType,
  Quantity,
  ReactorModel,
} from './model.js';

export interface OpenMcArtifacts {
  materialsXml: string;
  geometryXml: string;
  settingsXml: string;
  talliesXml: string;
  plotsXml: string;
}

export function generateOpenMcArtifacts(model: ReactorModel): OpenMcArtifacts {
  return {
    materialsXml: generateMaterialsXml(model.materials.materials),
    geometryXml: generateGeometryXml(model),
    settingsXml: generateSettingsXml(model),
    talliesXml: generateTalliesXml(model),
    plotsXml: generatePlotsXml(model),
  };
}

function generateMaterialsXml(materials: MaterialDefinition[]): string {
  const body = materials
    .map((material, index) => {
      const nuclides = material.nuclides
        .map((nuclide) => `    <nuclide name="${escapeXml(nuclide.name)}" ${nuclide.fractionType === 'atom' ? 'ao' : 'wo'}="${nuclide.fraction}" />`)
        .join('\n');

      const temperature = material.temperature ? `    <temperature>${material.temperature.unit === 'C' ? material.temperature.value + 273.15 : material.temperature.value}</temperature>` : '';

      return [
        `  <material id="${index + 1}" name="${escapeXml(material.name)}">`,
        `    <density value="${material.density.value}" units="${escapeXml(material.density.unit)}" />`,
        temperature,
        nuclides,
        '  </material>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return xmlDocument('materials', body);
}

function generateGeometryXml(model: ReactorModel): string {
  if (model.components && (model.components.pinCellTypes.length > 0 || model.components.coreLayout)) {
    return generateComponentGeometry(model);
  }

  if (model.openmcGeometry && model.openmcGeometry.surfaces.length > 0 && model.openmcGeometry.cells.length > 0) {
    const surfaces = model.openmcGeometry.surfaces
      .map((surface) => {
        const boundary = surface.boundary && surface.boundary !== 'transmission' ? ` boundary="${escapeXml(surface.boundary)}"` : '';
        const surfaceType = surface.type === 'macrobody' ? 'macrobody' : surface.type;
        return `  <surface id="${surface.openmcId}" name="${escapeXml(surface.name)}" type="${surfaceType}" coeffs="${surface.coeffs.join(' ')}"${boundary} />`;
      })
      .join('\n');
    const cells = model.openmcGeometry.cells
      .map((cell) => {
        const material = cell.materialOpenMcId ? ` material="${cell.materialOpenMcId}"` : cell.materialId ? ` material="${materialOpenMcId(model, cell.materialId)}"` : ' material="void"';
        const fill = cell.fillUniverse ? ` fill="${cell.fillUniverse}"` : '';
        return `  <cell id="${cell.openmcId}" name="${escapeXml(cell.name)}" universe="${cell.universe ?? 0}"${fill}${fill ? '' : material} region="${escapeXml(cell.region)}" />`;
      })
      .join('\n');
    return xmlDocument('geometry', [surfaces, cells].join('\n'));
  }

  const rootName = escapeXml(model.root.name);
  const comment = `  <!-- Geometry preview for ${rootName}. Full CSG generation will expand hierarchy/lattices deterministically. -->`;
  const cells = collectNodeNames(model)
    .map((name, index) => `  <cell id="${index + 1}" name="${escapeXml(name)}" />`)
    .join('\n');

  return xmlDocument('geometry', [comment, cells].join('\n'));
}

function materialOpenMcId(model: ReactorModel, materialId: string): number {
  const index = model.materials.materials.findIndex((material) => material.id === materialId);
  return index >= 0 ? index + 1 : 0;
}

function generateComponentGeometry(model: ReactorModel): string {
  const components = model.components!;
  const lines: string[] = [];
  let nextSurfaceId = 1;
  let nextCellId = 1;
  let nextUniverseId = 1;
  let nextLatticeId = 1;

  const pinUniverseIds = new Map<string, number>();
  const assemblyUniverseIds = new Map<string, number>();

  // Generate pin cell universes
  for (const pinType of components.pinCellTypes) {
    const universeId = nextUniverseId++;
    pinUniverseIds.set(pinType.id, universeId);

    // Outer boundary surface (moderator region outer edge = pitch/2 * sqrt(2) for rectangular, pitch/2 for hex)
    const moderatorOuterRadius = pinType.pitch * 0.7;
    const outerSurfaceId = nextSurfaceId++;
    lines.push(`  <surface id="${outerSurfaceId}" name="${escapeXml(pinType.name)} outer boundary" type="z-cylinder" coeffs="0 0 ${moderatorOuterRadius}" boundary="reflective" />`);

    // Ring surfaces and cells (from innermost to outermost)
    const surfaceIds: number[] = [];
    for (const ring of pinType.rings) {
      const surfaceId = nextSurfaceId++;
      surfaceIds.push(surfaceId);
      lines.push(`  <surface id="${surfaceId}" name="${escapeXml(pinType.name)} ${escapeXml(ring.name)} outer" type="z-cylinder" coeffs="0 0 ${ring.outerRadius}" />`);
    }

    // Cells for each ring
    for (let i = 0; i < pinType.rings.length; i++) {
      const ring = pinType.rings[i];
      const cellId = nextCellId++;
      const matId = materialOpenMcId(model, ring.materialId);
      const temp = ring.temperature ? ` temperature="${ring.temperature}"` : '';
      let region: string;
      if (i === 0) {
        region = `-${surfaceIds[0]}`;
      } else {
        region = `+${surfaceIds[i - 1]} -${surfaceIds[i]}`;
      }
      lines.push(`  <cell id="${cellId}" name="${escapeXml(pinType.name)} ${escapeXml(ring.name)}" universe="${universeId}" material="${matId}"${temp} region="${region}" />`);
    }

    // Moderator cell (optional)
    if (pinType.moderatorMaterialId) {
      const moderatorCellId = nextCellId++;
      const moderatorMatId = materialOpenMcId(model, pinType.moderatorMaterialId);
      const lastRingSurfaceId = surfaceIds[surfaceIds.length - 1];
      lines.push(`  <cell id="${moderatorCellId}" name="${escapeXml(pinType.name)} moderator" universe="${universeId}" material="${moderatorMatId}" region="+${lastRingSurfaceId} -${outerSurfaceId}" />`);
    }
  }

  // Generate assembly lattices
  for (const assemblyType of components.assemblyTypes) {
    const universeId = nextUniverseId++;
    assemblyUniverseIds.set(assemblyType.id, universeId);
    const latticeId = nextLatticeId++;
    const halfWidth = (assemblyType.columns * assemblyType.pitch) / 2;
    const halfHeight = (assemblyType.rows * assemblyType.pitch) / 2;

    // Outer universe for assembly boundary
    const outerUniverseId = nextUniverseId++;
    const outerCellId = nextCellId++;
    lines.push(`  <cell id="${outerCellId}" name="${escapeXml(assemblyType.name)} outer" universe="${outerUniverseId}" material="${materialOpenMcId(model, assemblyType.outerMaterialId ?? 'void')}" />`);

    if (assemblyType.latticeKind === 'hex') {
      const nRings = Math.max(assemblyType.rows, assemblyType.columns);
      lines.push(`  <hex_lattice id="${latticeId}" name="${escapeXml(assemblyType.name)}" n_rings="${nRings}" outer="${outerUniverseId}">`);
      lines.push(`    <center>0 0</center>`);
      lines.push(`    <pitch>${assemblyType.pitch}</pitch>`);
      lines.push(`    <universes>`);
      // Use hexRings if available (already in OpenMC's outermost-first format)
      // Otherwise convert from pinMap (diamond shape) to ring format
      const ringData = assemblyType.hexRings ?? convertPinMapToHexRings(assemblyType.pinMap, nRings, pinUniverseIds);
      for (const ring of ringData) {
        const ids = ring.map((pinId) => pinUniverseIds.get(pinId) ?? 0);
        lines.push(`      ${ids.join(' ')}`);
      }
      lines.push(`    </universes>`);
      lines.push(`  </hex_lattice>`);
    } else {
      lines.push(`  <lattice id="${latticeId}" name="${escapeXml(assemblyType.name)}" dimension="${assemblyType.columns} ${assemblyType.rows}" outer="${outerUniverseId}">`);
      lines.push(`    <lower_left>-${halfWidth} -${halfHeight}</lower_left>`);
      lines.push(`    <pitch>${assemblyType.pitch} ${assemblyType.pitch}</pitch>`);
      lines.push(`    <universes>`);
      for (const row of assemblyType.pinMap) {
        const ids = row.map((pinId) => pinUniverseIds.get(pinId) ?? 0);
        lines.push(`      ${ids.join(' ')}`);
      }
      lines.push(`    </universes>`);
      lines.push(`  </lattice>`);
    }

    // Fill cell for the assembly universe
    const fillCellId = nextCellId++;
    lines.push(`  <cell id="${fillCellId}" name="${escapeXml(assemblyType.name)} fill" universe="${universeId}" fill="${latticeId}" />`);
  }

  // Generate core lattice
  if (components.coreLayout) {
    const core = components.coreLayout;
    const coreUniverseId = 0; // root universe
    const coreLatticeId = nextLatticeId++;
    const halfWidth = (core.columns * core.assemblyPitch) / 2;
    const halfHeight = (core.rows * core.assemblyPitch) / 2;

    // Reflector cells
    if (core.reflectorMaterialId) {
      const reflectorCellId = nextCellId++;
      const reflectorMatId = materialOpenMcId(model, core.reflectorMaterialId);
      lines.push(`  <cell id="${reflectorCellId}" name="reflector" universe="${coreUniverseId}" material="${reflectorMatId}" />`);
    }

    // Core lattice
    if (core.latticeKind === 'hex') {
      const nRings = Math.max(core.rows, core.columns);
      lines.push(`  <hex_lattice id="${coreLatticeId}" name="core lattice" n_rings="${nRings}">`);
      lines.push(`    <center>0 0</center>`);
      lines.push(`    <pitch>${core.assemblyPitch}</pitch>`);
      lines.push(`    <universes>`);
      // Use hexRings if available (already in OpenMC's outermost-first format)
      // Otherwise convert from assemblyMap (diamond shape) to ring format
      const ringData = core.hexRings ?? convertAssemblyMapToHexRings(core.assemblyMap, nRings, assemblyUniverseIds);
      for (const ring of ringData) {
        const ids = ring.map((assemblyId) => assemblyUniverseIds.get(assemblyId) ?? 0);
        lines.push(`      ${ids.join(' ')}`);
      }
      lines.push(`    </universes>`);
      lines.push(`  </hex_lattice>`);
    } else {
      lines.push(`  <lattice id="${coreLatticeId}" name="core lattice" dimension="${core.columns} ${core.rows}">`);
      lines.push(`    <lower_left>-${halfWidth} -${halfHeight}</lower_left>`);
      lines.push(`    <pitch>${core.assemblyPitch} ${core.assemblyPitch}</pitch>`);
      lines.push(`    <universes>`);
      for (const row of core.assemblyMap) {
        const ids = row.map((assemblyId) => assemblyUniverseIds.get(assemblyId) ?? 0);
        lines.push(`      ${ids.join(' ')}`);
      }
      lines.push(`    </universes>`);
      lines.push(`  </lattice>`);
    }

    // Root cell filled with core lattice
    if (core.vesselMaterialId && core.vesselThickness) {
      const vesselSurfaceId = nextSurfaceId++;
      const vesselThickness = core.vesselThickness;
      const vesselOuterRadius = Math.max(halfWidth, halfHeight) + vesselThickness;
      lines.push(`  <surface id="${vesselSurfaceId}" name="vessel outer" type="z-cylinder" coeffs="0 0 ${vesselOuterRadius}" boundary="vacuum" />`);
      const vesselCellId = nextCellId++;
      const vesselMatId = materialOpenMcId(model, core.vesselMaterialId);
      lines.push(`  <cell id="${vesselCellId}" name="vessel" universe="${coreUniverseId}" material="${vesselMatId}" region="+${coreLatticeId} -${vesselSurfaceId}" />`);
      const coreFillCellId = nextCellId++;
      lines.push(`  <cell id="${coreFillCellId}" name="core fill" universe="${coreUniverseId}" fill="${coreLatticeId}" region="-${coreLatticeId}" />`);
    } else {
      const coreFillCellId = nextCellId++;
      lines.push(`  <cell id="${coreFillCellId}" name="core fill" universe="${coreUniverseId}" fill="${coreLatticeId}" />`);
    }
  }

  return xmlDocument('geometry', lines.join('\n'));
}

function generateSettingsXml(model: ReactorModel): string {
  const lines = [`  <run_mode>${model.settings.mode === 'fixed-source' ? 'fixed source' : 'eigenvalue'}</run_mode>`, `  <particles>${model.settings.particles}</particles>`];
  if (model.settings.batches) lines.push(`  <batches>${model.settings.batches}</batches>`);
  if (model.settings.inactive) lines.push(`  <inactive>${model.settings.inactive}</inactive>`);

  // Temperature settings
  if (model.settings.temperature) {
    const temp = model.settings.temperature;
    lines.push('  <temperature>');
    lines.push(`    <default>${temp.default}</default>`);
    if (temp.method) lines.push(`    <method>${temp.method}</method>`);
    if (temp.multipole) lines.push(`    <multipole>true</multipole>`);
    if (temp.range) lines.push(`    <range>${temp.range[0]} ${temp.range[1]}</range>`);
    lines.push('  </temperature>');
  }

  // Coupled thermal feedback hooks (for orchestration/driver loops)
  if (model.settings.thermalFeedback?.enabled) {
    const feedback = model.settings.thermalFeedback;
    lines.push('  <thermal_feedback>');
    lines.push('    <enabled>true</enabled>');
    lines.push(`    <max_iterations>${feedback.maxIterations}</max_iterations>`);
    lines.push(`    <convergence_tolerance>${feedback.convergenceTolerance}</convergence_tolerance>`);
    if (feedback.updateStrategy) lines.push(`    <update_strategy>${escapeXml(feedback.updateStrategy)}</update_strategy>`);
    if (feedback.relaxationFactor !== undefined) lines.push(`    <relaxation_factor>${feedback.relaxationFactor}</relaxation_factor>`);
    if (feedback.materialTemperatures.length > 0) {
      lines.push('    <materials>');
      for (const material of feedback.materialTemperatures) {
        lines.push(`      <material id="${escapeXml(material.materialId)}" temperature="${material.temperature}"${material.thermalExpansionCoefficient !== undefined ? ` thermal_expansion_coefficient="${material.thermalExpansionCoefficient}"` : ''} />`);
      }
      lines.push('    </materials>');
    }
    lines.push('  </thermal_feedback>');
  }

  // Entropy mesh
  if (model.settings.entropyMesh) {
    const mesh = model.settings.entropyMesh;
    lines.push('  <entropy_mesh>');
    lines.push(`    <dimension>${mesh.dimension.join(' ')}</dimension>`);
    lines.push(`    <lower_left>${mesh.lowerLeft.join(' ')}</lower_left>`);
    lines.push(`    <upper_right>${mesh.upperRight.join(' ')}</upper_right>`);
    lines.push('  </entropy_mesh>');
  }

  // Cross sections
  if (model.settings.crossSections?.path) {
    lines.push(`  <cross_sections>${escapeXml(model.settings.crossSections.path)}</cross_sections>`);
  }

  // Sources for fixed-source mode
  if (model.settings.mode === 'fixed-source' && model.sources.length > 0) {
    lines.push('  <source>');
    for (const source of model.sources) {
      lines.push(`    <space type="${source.type}" />`);
      if (source.type === 'point' && source.parameters) {
        lines.push(`      <parameters>${source.parameters.x ?? 0} ${source.parameters.y ?? 0} ${source.parameters.z ?? 0}</parameters>`);
      }
      if (source.energy) {
        lines.push(`    <energy type="monoenergetic" />`);
        lines.push(`      <parameters>${energyInEv(source.energy)}</parameters>`);
      }
      if (source.angle) {
        if (source.angle.type === 'isotropic') {
          lines.push('    <angle type="isotropic" />');
        } else {
          lines.push(`    <angle type="monodirectional" />`);
          lines.push(`      <parameters>${source.angle.u ?? 0} ${source.angle.v ?? 0} ${source.angle.w ?? 1}</parameters>`);
        }
      }
    }
    lines.push('  </source>');
  }

  // ── Variance Reduction ──
  if (model.settings.varianceReduction) {
    const vr = model.settings.varianceReduction;
    if (vr.weightWindows?.enabled) {
      const ww = vr.weightWindows;
      lines.push('  <weight_windows>');
      if (ww.method) lines.push(`    <method>${ww.method}</method>`);
      if (ww.survivalRatio) lines.push(`    <survival_ratio>${ww.survivalRatio}</survival_ratio>`);
      if (ww.maxSplit) lines.push(`    <max_split>${ww.maxSplit}</max_split>`);
      if (ww.weightCutoff) lines.push(`    <weight_cutoff>${ww.weightCutoff}</weight_cutoff>`);
      if (ww.lowerBounds?.length) lines.push(`    <lower_bounds>${ww.lowerBounds.join(' ')}</lower_bounds>`);
      if (ww.upperBounds?.length) lines.push(`    <upper_bounds>${ww.upperBounds.join(' ')}</upper_bounds>`);
      if (ww.energyBounds?.length) lines.push(`    <energy_bounds>${ww.energyBounds.join(' ')}</energy_bounds>`);
      lines.push('  </weight_windows>');
    }
    if (vr.survivalBiasing?.enabled) {
      const sb = vr.survivalBiasing;
      lines.push('  <survival_biasing>');
      if (sb.cutoff) lines.push(`    <cutoff>${sb.cutoff}</cutoff>`);
      if (sb.survivalMultiplier) lines.push(`    <survival_multiplier>${sb.survivalMultiplier}</survival_multiplier>`);
      lines.push('  </survival_biasing>');
    }
    if (vr.russianRoulette?.enabled) {
      const rr = vr.russianRoulette;
      lines.push('  <russian_roulette>');
      if (rr.weightThreshold) lines.push(`    <weight_threshold>${rr.weightThreshold}</weight_threshold>`);
      if (rr.survivalWeight) lines.push(`    <survival_weight>${rr.survivalWeight}</survival_weight>`);
      lines.push('  </russian_roulette>');
    }
  }

  // ── Multi-Group Cross Sections ──
  if (model.settings.mgxs?.enabled) {
    const mgxs = model.settings.mgxs;
    lines.push('  <multi_group_cross_sections>');
    if (mgxs.libraryPath) lines.push(`    <library_path>${escapeXml(mgxs.libraryPath)}</library_path>`);
    if (mgxs.energyGroups) {
      lines.push(`    <energy_groups name="${escapeXml(mgxs.energyGroups.name)}">`);
      lines.push(`      <boundaries>${mgxs.energyGroups.boundaries.join(' ')}</boundaries>`);
      lines.push('    </energy_groups>');
    }
    if (mgxs.domainType) lines.push(`    <domain_type>${mgxs.domainType}</domain_type>`);
    if (mgxs.domainIds?.length) lines.push(`    <domain_ids>${mgxs.domainIds.join(' ')}</domain_ids>`);
    if (mgxs.scatterFormat) lines.push(`    <scatter_format>${mgxs.scatterFormat}</scatter_format>`);
    if (mgxs.order) lines.push(`    <order>${mgxs.order}</order>`);
    if (mgxs.temperature) lines.push(`    <temperature>${mgxs.temperature}</temperature>`);
    lines.push('  </multi_group_cross_sections>');
  }

  // ── Stochastic Volume Calculation ──
  if (model.settings.stochasticVolume?.enabled) {
    const sv = model.settings.stochasticVolume;
    lines.push('  <stochastic_volume>');
    if (sv.domainType) lines.push(`    <domain_type>${sv.domainType}</domain_type>`);
    if (sv.domainIds?.length) lines.push(`    <domain_ids>${sv.domainIds.join(' ')}</domain_ids>`);
    if (sv.samples) lines.push(`    <samples>${sv.samples}</samples>`);
    if (sv.lowerLeft) lines.push(`    <lower_left>${sv.lowerLeft.join(' ')}</lower_left>`);
    if (sv.upperRight) lines.push(`    <upper_right>${sv.upperRight.join(' ')}</upper_right>`);
    lines.push('  </stochastic_volume>');
  }

  // ── Kinetics Parameters ──
  if (model.settings.kinetics?.enabled) {
    const kin = model.settings.kinetics;
    lines.push('  <kinetics>');
    if (kin.method) lines.push(`    <method>${kin.method}</method>`);
    if (kin.batches) lines.push(`    <batches>${kin.batches}</batches>`);
    if (kin.numGenerations) lines.push(`    <num_generations>${kin.numGenerations}</num_generations>`);
    if (kin.timeAbsorption) lines.push(`    <time_absorption>${kin.timeAbsorption}</time_absorption>`);
    lines.push('  </kinetics>');
  }

  // ── Decay Sources ──
  if (model.settings.decaySource?.enabled) {
    const ds = model.settings.decaySource;
    lines.push('  <decay_source>');
    if (ds.chains?.length) lines.push(`    <chains>${ds.chains.map(c => escapeXml(c)).join(' ')}</chains>`);
    if (ds.timesteps?.length) lines.push(`    <timesteps>${ds.timesteps.join(' ')}</timesteps>`);
    if (ds.timestepUnits) lines.push(`    <timestep_units>${ds.timestepUnits}</timestep_units>`);
    if (ds.particles) lines.push(`    <particles>${ds.particles}</particles>`);
    if (ds.sourceRate) lines.push(`    <source_rate>${ds.sourceRate}</source_rate>`);
    lines.push('  </decay_source>');
  }

  // ── Random Ray Solver ──
  if (model.settings.randomRay?.enabled) {
    const rr = model.settings.randomRay;
    lines.push('  <random_ray>');
    if (rr.rayLength) lines.push(`    <ray_length>${rr.rayLength}</ray_length>`);
    if (rr.raysPerCell) lines.push(`    <rays_per_cell>${rr.raysPerCell}</rays_per_cell>`);
    if (rr.sourceType) lines.push(`    <source_type>${rr.sourceType}</source_type>`);
    if (rr.maxIterations) lines.push(`    <max_iterations>${rr.maxIterations}</max_iterations>`);
    if (rr.convergenceTolerance) lines.push(`    <convergence_tolerance>${rr.convergenceTolerance}</convergence_tolerance>`);
    lines.push('  </random_ray>');
  }

  // ── CMFD Acceleration ──
  if (model.settings.cmfd?.enabled) {
    const cmfd = model.settings.cmfd;
    lines.push('  <cmfd>');
    if (cmfd.meshDimension) lines.push(`    <mesh_dimension>${cmfd.meshDimension.join(' ')}</mesh_dimension>`);
    if (cmfd.lowerLeft) lines.push(`    <lower_left>${cmfd.lowerLeft.join(' ')}</lower_left>`);
    if (cmfd.upperRight) lines.push(`    <upper_right>${cmfd.upperRight.join(' ')}</upper_right>`);
    if (cmfd.albedo) lines.push(`    <albedo>${cmfd.albedo.join(' ')}</albedo>`);
    if (cmfd.coarseGroupStructure?.length) lines.push(`    <coarse_groups>${cmfd.coarseGroupStructure.join(' ')}</coarse_groups>`);
    if (cmfd.powerIteration) {
      lines.push('    <power_iteration>');
      if (cmfd.powerIteration.tolerance) lines.push(`      <tolerance>${cmfd.powerIteration.tolerance}</tolerance>`);
      if (cmfd.powerIteration.maxIterations) lines.push(`      <max_iterations>${cmfd.powerIteration.maxIterations}</max_iterations>`);
      lines.push('    </power_iteration>');
    }
    lines.push('  </cmfd>');
  }

  // ── Photon Transport ──
  if (model.settings.photonTransport?.enabled) {
    const pt = model.settings.photonTransport;
    lines.push('  <photon_transport>');
    lines.push(`    <enabled>true</enabled>`);
    if (pt.captureGamma !== undefined) lines.push(`    <capture_gamma>${pt.captureGamma}</capture_gamma>`);
    if (pt.electronTransport !== undefined) lines.push(`    <electron_transport>${pt.electronTransport}</electron_transport>`);
    if (pt.pairProduction !== undefined) lines.push(`    <pair_production>${pt.pairProduction}</pair_production>`);
    if (pt.comptonScattering !== undefined) lines.push(`    <compton_scattering>${pt.comptonScattering}</compton_scattering>`);
    if (pt.photoelectric !== undefined) lines.push(`    <photoelectric>${pt.photoelectric}</photoelectric>`);
    lines.push('  </photon_transport>');
  }

  // ── CAD Import ──
  if (model.settings.cadImport?.enabled) {
    const cad = model.settings.cadImport;
    lines.push('  <cad_import>');
    if (cad.filePath) lines.push(`    <file_path>${escapeXml(cad.filePath)}</file_path>`);
    if (cad.format) lines.push(`    <format>${cad.format}</format>`);
    if (cad.tolerance) lines.push(`    <tolerance>${cad.tolerance}</tolerance>`);
    lines.push('  </cad_import>');
  }

  // ── MPI Configuration ──
  if (model.settings.mpi?.enabled) {
    const mpi = model.settings.mpi;
    lines.push('  <mpi>');
    if (mpi.processes) lines.push(`    <processes>${mpi.processes}</processes>`);
    if (mpi.threads) lines.push(`    <threads>${mpi.threads}</threads>`);
    if (mpi.domainDecomposition) {
      lines.push('    <domain_decomposition>');
      if (mpi.domains) lines.push(`      <domains>${mpi.domains.join(' ')}</domains>`);
      lines.push('    </domain_decomposition>');
    }
    lines.push('  </mpi>');
  }

  // ── Perturbation/Sensitivity ──
  if (model.settings.perturbation?.enabled) {
    const pert = model.settings.perturbation;
    lines.push('  <perturbation>');
    if (pert.method) lines.push(`    <method>${pert.method}</method>`);
    if (pert.nuclides?.length) lines.push(`    <nuclides>${pert.nuclides.map(n => escapeXml(n)).join(' ')}</nuclides>`);
    if (pert.reactions?.length) lines.push(`    <reactions>${pert.reactions.join(' ')}</reactions>`);
    if (pert.deltaK) lines.push(`    <delta_k>true</delta_k>`);
    if (pert.coefficients) lines.push(`    <coefficients>true</coefficients>`);
    lines.push('  </perturbation>');
  }

  return xmlDocument('settings', lines.join('\n'));
}

function energyInEv(energy: Quantity<EnergyUnit>): number {
  if (energy.unit === 'MeV') return energy.value * 1e6;
  if (energy.unit === 'keV') return energy.value * 1e3;
  return energy.value;
}

function generateTalliesXml(model: ReactorModel): string {
  const lines: string[] = [];
  const derivatives: string[] = [];
  const derivativeIds = new Map<string, number>();
  let nextDerivativeId = 1;

  // Generate standalone meshes from model.meshes
  if (model.meshes) {
    for (const mesh of model.meshes) {
      const meshId = parseInt(mesh.id, 10) || 1;
      lines.push(generateMeshXml(mesh, meshId));
    }
  }

  const meshBySignature = new Map<string, number>();
  let nextMeshId = (model.meshes?.length ?? 0) + 1;

  const derivativeIdFor = (nuclide: string): number => {
    const normalized = nuclide.trim();
    const existing = derivativeIds.get(normalized);
    if (existing) return existing;

    const derivativeId = nextDerivativeId++;
    derivativeIds.set(normalized, derivativeId);
    derivatives.push(`  <derivative id="${derivativeId}">`);
    derivatives.push('    <variable>nuclide_density</variable>');
    derivatives.push(`    <nuclide>${escapeXml(normalized)}</nuclide>`);
    derivatives.push('  </derivative>');
    return derivativeId;
  };

  const meshFilterIdFor = (filter: { ids?: string[]; bins?: number[] }): number | null => {
    const dim = filter.ids?.[0]?.trim();
    const lower = filter.ids?.[1]?.trim();
    const upper = filter.ids?.[2]?.trim();
    if (!dim || !lower || !upper) return null;

    const signature = `${dim}|${lower}|${upper}`;
    const existing = meshBySignature.get(signature);
    if (existing) return existing;

    const meshId = nextMeshId++;
    meshBySignature.set(signature, meshId);
    lines.push(`  <mesh id="${meshId}">`);
    lines.push(`    <dimension>${escapeXml(dim)}</dimension>`);
    lines.push(`    <lower_left>${escapeXml(lower)}</lower_left>`);
    lines.push(`    <upper_right>${escapeXml(upper)}</upper_right>`);
    lines.push('  </mesh>');
    return meshId;
  };

  const tallyBlocks = model.tallies
    .map((tally, index) => {
      const lines = [`  <tally id="${index + 1}" name="${escapeXml(tally.name)}">`];

      // Filters
      if (tally.filters) {
        for (const filter of tally.filters) {
          if (filter.type === 'energy' && filter.bins) {
            lines.push(`    <filter type="energy">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'cell' && filter.ids?.length) {
            const bins = filter.ids.map((id) => id.trim()).filter(Boolean);
            if (bins.length > 0) {
              lines.push(`    <filter type="cell">`);
              lines.push(`      <bins>${bins.join(' ')}</bins>`);
              lines.push(`    </filter>`);
            }
          }
          if (filter.type === 'material' && filter.ids?.length) {
            const bins = filter.ids.map((id) => id.trim()).filter(Boolean);
            if (bins.length > 0) {
              lines.push(`    <filter type="material">`);
              lines.push(`      <bins>${bins.join(' ')}</bins>`);
              lines.push(`    </filter>`);
            }
          }
          if (filter.type === 'universe' && filter.ids?.length) {
            const bins = filter.ids.map((id) => id.trim()).filter(Boolean);
            if (bins.length > 0) {
              lines.push(`    <filter type="universe">`);
              lines.push(`      <bins>${bins.join(' ')}</bins>`);
              lines.push(`    </filter>`);
            }
          }
          if (filter.type === 'surface' && filter.ids?.length) {
            const bins = filter.ids.map((id) => id.trim()).filter(Boolean);
            if (bins.length > 0) {
              lines.push(`    <filter type="surface">`);
              lines.push(`      <bins>${bins.join(' ')}</bins>`);
              lines.push(`    </filter>`);
            }
          }
          if (filter.type === 'mesh') {
            const meshId = meshFilterIdFor(filter);
            if (meshId) {
              lines.push(`    <filter type="mesh">`);
              lines.push(`      <bins>${meshId}</bins>`);
              lines.push(`    </filter>`);
            }
          }
          if (filter.type === 'mu' && filter.bins) {
            lines.push(`    <filter type="mu">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'polar' && filter.bins) {
            lines.push(`    <filter type="polar">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'azimuthal' && filter.bins) {
            lines.push(`    <filter type="azimuthal">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'legendre' && filter.bins) {
            lines.push(`    <filter type="legendre">`);
            lines.push(`      <bins>${filter.bins[0] ?? 0}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'zernike' && filter.bins) {
            lines.push(`    <filter type="zernike">`);
            lines.push(`      <bins>${filter.bins[0] ?? 0}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'time' && filter.bins) {
            lines.push(`    <filter type="time">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'weight' && filter.bins) {
            lines.push(`    <filter type="weight">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'collision' && filter.bins) {
            lines.push(`    <filter type="collision">`);
            lines.push(`      <bins>${filter.bins[0] ?? 0}</bins>`);
            lines.push(`    </filter>`);
          }
          if (filter.type === 'delayedgroup' && filter.bins) {
            lines.push(`    <filter type="delayedgroup">`);
            lines.push(`      <bins>${filter.bins.join(' ')}</bins>`);
            lines.push(`    </filter>`);
          }
        }
      }

      // Legacy energy bins support
      if (tally.energyBins && tally.energyBins.length > 0 && !tally.filters?.some((f) => f.type === 'energy')) {
        const binsInEv = tally.energyBins.map(energyInEv);
        lines.push('    <filter type="energy">');
        lines.push(`      <bins>${binsInEv.join(' ')}</bins>`);
        lines.push('    </filter>');
      }

      lines.push(`    <scores>${tally.scores.map(escapeXml).join(' ')}</scores>`);

      if (tally.nuclides && tally.nuclides.length > 0) {
        lines.push(`    <nuclides>${tally.nuclides.map(escapeXml).join(' ')}</nuclides>`);
      }

      if (tally.sensitivity?.enabled) {
        const sensitivityScores = tally.sensitivity.scores.length > 0 ? tally.sensitivity.scores : tally.scores;
        lines.push(`    <scores>${sensitivityScores.map(escapeXml).join(' ')}</scores>`);
        lines.push('    <filter type="particle">');
        lines.push('      <bins>neutron</bins>');
        lines.push('    </filter>');

        for (const nuclide of tally.sensitivity.nuclides) {
          const derivativeId = derivativeIdFor(nuclide);
          lines.push(`    <derivative>${derivativeId}</derivative>`);
        }
      }

      lines.push('  </tally>');
      return lines.join('\n');
    })
    .join('\n');

  const body = [lines.join('\n'), derivatives.join('\n'), tallyBlocks].filter(Boolean).join('\n');
  return xmlDocument('tallies', body);
}

function generatePlotsXml(model: ReactorModel): string {
  let pitchCm = 20;
  let rowCount = 5;

  if (model.components?.coreLayout) {
    pitchCm = model.components.coreLayout.assemblyPitch;
    rowCount = model.components.coreLayout.rows;
  } else if (model.components?.assemblyTypes[0]) {
    pitchCm = model.components.assemblyTypes[0].pitch;
    rowCount = model.components.assemblyTypes[0].rows;
  } else {
    const lattice = model.lattices[0];
    pitchCm = lattice?.pitch?.unit === 'm' ? lattice.pitch.value * 100 : lattice?.pitch?.value ?? 20;
    rowCount = lattice?.map.length ?? 5;
  }

  const width = Math.max(100, Math.round(rowCount * pitchCm * 1.5));
  const basis = model.settings.plotBasis ?? (model.family === 'shielding-fixed-source' ? 'xz' : 'xy');

  return xmlDocument(
    'plots',
    [
      '  <plot id="1">',
      `    <filename>openmc-studio-${basis}-preview</filename>`,
      '    <origin>0 0 0</origin>',
      `    <width>${width} ${width}</width>`,
      '    <pixels>900 900</pixels>',
      `    <basis>${basis}</basis>`,
      '    <color_by>material</color_by>',
      '  </plot>',
    ].join('\n'),
  );
}

function generateMeshXml(mesh: import('./model.js').MeshDefinition, id: number): string {
  const lines = [`  <mesh id="${id}">`];

  switch (mesh.type) {
    case 'regular':
      if (mesh.dimension) lines.push(`    <dimension>${mesh.dimension.join(' ')}</dimension>`);
      if (mesh.lowerLeft) lines.push(`    <lower_left>${mesh.lowerLeft.join(' ')}</lower_left>`);
      if (mesh.upperRight) lines.push(`    <upper_right>${mesh.upperRight.join(' ')}</upper_right>`);
      if (mesh.width) lines.push(`    <width>${mesh.width.join(' ')}</width>`);
      break;
    case 'rectilinear':
      if (mesh.xGrid) lines.push(`    <x_grid>${mesh.xGrid.join(' ')}</x_grid>`);
      if (mesh.yGrid) lines.push(`    <y_grid>${mesh.yGrid.join(' ')}</y_grid>`);
      if (mesh.zGrid) lines.push(`    <z_grid>${mesh.zGrid.join(' ')}</z_grid>`);
      break;
    case 'cylindrical':
      if (mesh.rGrid) lines.push(`    <r_grid>${mesh.rGrid.join(' ')}</r_grid>`);
      if (mesh.phiGrid) lines.push(`    <phi_grid>${mesh.phiGrid.join(' ')}</phi_grid>`);
      if (mesh.zGrid) lines.push(`    <z_grid>${mesh.zGrid.join(' ')}</z_grid>`);
      break;
    case 'spherical':
      if (mesh.rGrid) lines.push(`    <r_grid>${mesh.rGrid.join(' ')}</r_grid>`);
      if (mesh.thetaGrid) lines.push(`    <theta_grid>${mesh.thetaGrid.join(' ')}</theta_grid>`);
      if (mesh.phiGrid) lines.push(`    <phi_grid>${mesh.phiGrid.join(' ')}</phi_grid>`);
      break;
    case 'unstructured':
      if (mesh.meshFile) lines.push(`    <mesh_file>${escapeXml(mesh.meshFile)}</mesh_file>`);
      if (mesh.library) lines.push(`    <library>${mesh.library}</library>`);
      break;
  }

  lines.push('  </mesh>');
  return lines.join('\n');
}

function collectNodeNames(model: ReactorModel): string[] {
  const names: string[] = [];
  const visit = (node: ReactorModel['root']) => {
    names.push(node.name);
    node.children.forEach(visit);
  };
  visit(model.root);
  return names;
}

/** Convert diamond-shaped pinMap to OpenMC-style hex rings (outermost-to-innermost).
 *  This is a fallback for legacy data that doesn't have hexRings populated.
 */
function convertPinMapToHexRings(
  pinMap: string[][],
  numRings: number,
  pinUniverseIds: Map<string, number>,
): string[][] {
  // Generate axial positions for visual order (center-first)
  const positions: Array<{ q: number; r: number; ring: number; idx: number }> = [];
  positions.push({ q: 0, r: 0, ring: 0, idx: 0 });
  for (let ring = 1; ring < numRings; ring++) {
    let q = 0;
    let r = -ring;
    const dirs = [
      { dq: 1, dr: 0 }, { dq: 0, dr: 1 }, { dq: -1, dr: 1 },
      { dq: -1, dr: 0 }, { dq: 0, dr: -1 }, { dq: 1, dr: -1 },
    ];
    for (const dir of dirs) {
      for (let step = 0; step < ring; step++) {
        positions.push({ q, r, ring, idx: positions.length });
        q += dir.dq;
        r += dir.dr;
      }
    }
  }

  // Build visual order array from pinMap (diamond shape)
  const center = numRings - 1;
  const visualFlat: string[] = new Array(positions.length).fill('');
  for (const pos of positions) {
    const row = pos.r + center;
    const col = pos.q + center;
    if (row >= 0 && row < pinMap.length && col >= 0 && col < pinMap[row].length) {
      visualFlat[pos.idx] = pinMap[row][col] ?? '';
    }
  }

  // Convert visual order (center-first) to OpenMC order (outermost-first)
  const openmcRings: string[][] = [];
  for (let r = numRings - 1; r >= 0; r--) {
    const startIdx = r === 0 ? 0 : 1 + 3 * r * (r - 1);
    const count = r === 0 ? 1 : 6 * r;
    openmcRings.push(visualFlat.slice(startIdx, startIdx + count));
  }
  return openmcRings;
}

/** Convert diamond-shaped assemblyMap to OpenMC-style hex rings (outermost-to-innermost). */
function convertAssemblyMapToHexRings(
  assemblyMap: string[][],
  numRings: number,
  assemblyUniverseIds: Map<string, number>,
): string[][] {
  return convertPinMapToHexRings(assemblyMap, numRings, assemblyUniverseIds);
}

function xmlDocument(root: string, body: string): string {
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<${root}>`, body, `</${root}>`].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
