/** IFC 클래스 한글 라벨 — 뷰어 클래스 탭·자산 분류·검색 결과. 없는 클래스는 'Ifc' 뗀 영문 그대로 */
export const IFC_KO: Record<string, string> = {
  IfcWall: '벽', IfcSlab: '슬래브', IfcStair: '계단', IfcRamp: '램프', IfcDoor: '문', IfcWindow: '창', IfcColumn: '기둥', IfcBeam: '보', IfcRoof: '지붕', IfcCovering: '마감', IfcRailing: '난간', IfcCurtainWall: '커튼월', IfcFurnishingElement: '가구', IfcBuildingElementProxy: '기타 요소',
  IfcElectricDistributionBoard: '분전반·배전반', IfcTransformer: '변압기·인버터', IfcElectricGenerator: '발전기', IfcSwitchingDevice: '개폐기', IfcElectricFlowStorageDevice: 'UPS·축전지', IfcProtectiveDevice: '보호장치', IfcOutlet: '콘센트·충전기', IfcLightFixture: '조명', IfcSolarDevice: '태양광', IfcFlowMeter: '계량기', IfcCableCarrierSegment: '케이블 트레이', IfcCableSegment: '케이블', IfcElectricAppliance: '전기기기',
  IfcSensor: '감지기·센서', IfcUnitaryControlElement: '제어반·수신기', IfcController: '컨트롤러·서버', IfcActuator: '구동기·차단기', IfcCommunicationsAppliance: '통신장비', IfcAudioVisualAppliance: '영상·음향', IfcAlarm: '경보장치',
  IfcPump: '펌프', IfcTank: '수조·탱크', IfcValve: '밸브', IfcPipeSegment: '배관', IfcPipeFitting: '배관 이음', IfcFilter: '필터·정수', IfcInterceptor: '트랩', IfcSanitaryTerminal: '위생기구', IfcFireSuppressionTerminal: '스프링클러·소화전',
  IfcUnitaryEquipment: '공조기·FCU·실외기', IfcAirTerminal: '디퓨저', IfcAirTerminalBox: 'VAV', IfcDuctSegment: '덕트', IfcDuctFitting: '덕트 이음', IfcDamper: '댐퍼', IfcFan: '팬', IfcAirToAirHeatRecovery: '전열교환기', IfcChiller: '냉동기', IfcCoolingTower: '냉각탑', IfcBoiler: '보일러', IfcHeatExchanger: '열교환기', IfcHumidifier: '가습기', IfcCoil: '코일',
  IfcTransportElement: '승강기·에스컬레이터', IfcSpace: '공간', IfcBuildingStorey: '층',
}
export const ifcKo = (cls: string | null | undefined) => cls ? (IFC_KO[cls] ?? IFC_KO['Ifc' + cls] ?? cls.replace(/^Ifc/, '')) : ''
