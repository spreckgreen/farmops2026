export type ConnectorGender = "male" | "female" | "plug" | "receptacle" | "genderless";
export type ConnectorPolarity = "standard" | "reverse" | "not_applicable";
export type SignalType = "rf" | "data" | "power" | "display" | "audio" | "control" | "other";
export type CableDomain = "ham_radio" | "communications" | "compute" | "network";

export const CABLE_DOMAINS: Array<{ value: CableDomain; label: string }> = [
  { value: "ham_radio", label: "Ham Radio" },
  { value: "communications", label: "Communications" },
  { value: "compute", label: "Compute" },
  { value: "network", label: "Network" },
];

export function inventoryTypeCableDomain(itemType?: string | null): CableDomain | null {
  if (itemType === "23_2_ham_radio") return "ham_radio";
  if (itemType === "23_communication") return "communications";
  if (itemType === "23_3_compute") return "compute";
  if (itemType === "23_1_network") return "network";
  return null;
}

export interface ConnectorRef {
  id: string;
  family: string;
  display_name: string;
  description: string;
  aliases: string[];
  mating_key: string;
}

export interface ConnectableEnd {
  connector_type_id: string;
  connector_gender: ConnectorGender;
  polarity?: ConnectorPolarity | null;
}

export interface DevicePort extends ConnectableEnd {
  id: string;
  inventory_item_id: string;
  name: string;
  direction: "input" | "output" | "bidirectional";
  signal_type: SignalType;
  protocol?: string | null;
  impedance_ohms?: number | null;
  min_frequency_hz?: number | null;
  max_frequency_hz?: number | null;
  voltage_v?: number | null;
  max_current_a?: number | null;
  max_power_w?: number | null;
  required?: boolean;
  notes?: string | null;
  sort_order?: number;
}

export interface CableSpec {
  inventory_item_id: string;
  cable_type?: string | null;
  length?: number | null;
  length_unit?: "in" | "ft" | "mm" | "cm" | "m";
  awg?: number | null;
  impedance_ohms?: number | null;
  signal_types?: string[] | null;
  protocol?: string | null;
  max_frequency_hz?: number | null;
  voltage_v?: number | null;
  max_current_a?: number | null;
  max_power_w?: number | null;
  adapter_or_pigtail?: boolean;
  supported_domains?: CableDomain[] | null;
  ends: [CableEnd, CableEnd] | CableEnd[];
}

export interface CableEnd extends ConnectableEnd {
  end_label: "A" | "B";
}

export interface CompatibilityResult {
  compatible: boolean;
  orientation: "A-to-port" | "B-to-port" | null;
  warnings: string[];
  blockers: string[];
}

const complementaryGender = (a: ConnectorGender, b: ConnectorGender): boolean =>
  (a === "male" && b === "female") ||
  (a === "female" && b === "male") ||
  (a === "plug" && b === "receptacle") ||
  (a === "receptacle" && b === "plug") ||
  (a === "genderless" && b === "genderless");

export function endsMate(
  port: ConnectableEnd,
  cableEnd: ConnectableEnd,
  connectors: Map<string, ConnectorRef>,
): boolean {
  const portType = connectors.get(port.connector_type_id);
  const cableType = connectors.get(cableEnd.connector_type_id);
  if (!portType || !cableType || portType.mating_key !== cableType.mating_key) return false;
  if (!complementaryGender(port.connector_gender, cableEnd.connector_gender)) return false;
  const pPolarity = port.polarity ?? "standard";
  const cPolarity = cableEnd.polarity ?? "standard";
  return (
    pPolarity === "not_applicable" ||
    cPolarity === "not_applicable" ||
    pPolarity === cPolarity
  );
}

const normalized = (value?: string | null) => (value ?? "").trim().toLowerCase();

function assessRatings(port: DevicePort, cable: CableSpec): { warnings: string[]; blockers: string[] } {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const signalTypes = cable.signal_types ?? [];

  if (signalTypes.length && !signalTypes.includes(port.signal_type)) {
    blockers.push(`Cable is not rated for ${port.signal_type}.`);
  }
  if (port.protocol && cable.protocol && normalized(port.protocol) !== normalized(cable.protocol)) {
    blockers.push(`Protocol differs: port uses ${port.protocol}; cable is ${cable.protocol}.`);
  }
  if (port.impedance_ohms && cable.impedance_ohms && port.impedance_ohms !== cable.impedance_ohms) {
    blockers.push(
      `Impedance differs: port is ${port.impedance_ohms} Ω; cable is ${cable.impedance_ohms} Ω.`,
    );
  }
  if (port.max_frequency_hz && cable.max_frequency_hz && cable.max_frequency_hz < port.max_frequency_hz) {
    blockers.push("Cable frequency rating is below the port requirement.");
  }
  if (port.voltage_v && cable.voltage_v && cable.voltage_v < port.voltage_v) {
    blockers.push("Cable voltage rating is below the port requirement.");
  }
  if (port.max_current_a && cable.max_current_a && cable.max_current_a < port.max_current_a) {
    blockers.push("Cable current rating is below the port requirement.");
  }
  if (port.max_power_w && cable.max_power_w && cable.max_power_w < port.max_power_w) {
    blockers.push("Cable power rating is below the port requirement.");
  }

  if (port.signal_type === "rf" && !cable.impedance_ohms) warnings.push("Cable impedance is unknown.");
  if (port.signal_type === "power" && !cable.awg) warnings.push("Cable AWG is unknown.");
  if (port.protocol && !cable.protocol) warnings.push("Cable protocol/capability is unknown.");

  return { warnings, blockers };
}

export function cableCompatibility(
  port: DevicePort,
  cable: CableSpec,
  connectors: ConnectorRef[],
  requiredDomain?: CableDomain | null,
): CompatibilityResult {
  const catalog = new Map(connectors.map((connector) => [connector.id, connector]));
  const a = cable.ends.find((end) => end.end_label === "A");
  const b = cable.ends.find((end) => end.end_label === "B");
  if (!a || !b) {
    return {
      compatible: false,
      orientation: null,
      warnings: [],
      blockers: ["Cable must have both End A and End B recorded."],
    };
  }

  const orientation = endsMate(port, a, catalog)
    ? "A-to-port"
    : endsMate(port, b, catalog)
      ? "B-to-port"
      : null;
  if (!orientation) {
    return {
      compatible: false,
      orientation: null,
      warnings: [],
      blockers: ["Neither cable end physically mates with this port."],
    };
  }

  const ratings = assessRatings(port, cable);
  if (
    requiredDomain &&
    cable.supported_domains?.length &&
    !cable.supported_domains.includes(requiredDomain)
  ) {
    ratings.blockers.push(`Cable is not classified for ${CABLE_DOMAINS.find((domain) => domain.value === requiredDomain)?.label ?? requiredDomain}.`);
  }
  if (requiredDomain && !cable.supported_domains?.length) {
    ratings.warnings.push("Cable support domain is not classified.");
  }
  return {
    compatible: ratings.blockers.length === 0,
    orientation,
    warnings: ratings.warnings,
    blockers: ratings.blockers,
  };
}

export function compatibleCables(
  port: DevicePort,
  cables: CableSpec[],
  connectors: ConnectorRef[],
): Array<{ cable: CableSpec; result: CompatibilityResult }> {
  return cables
    .map((cable) => ({ cable, result: cableCompatibility(port, cable, connectors) }))
    .filter(({ result }) => result.compatible)
    .sort((a, b) => a.result.warnings.length - b.result.warnings.length);
}

export function connectorSearchText(connector: ConnectorRef): string {
  return [connector.display_name, connector.id, connector.family, ...connector.aliases]
    .join(" ")
    .toLowerCase();
}
