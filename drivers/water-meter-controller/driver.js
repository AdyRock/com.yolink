'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class WaterMeterControllerDriver extends yoLinkDriver
{

	/**
 * onInit is called when the driver is initialized.
 */
	async onInit()
	{
		this.deviceType = 'WaterMeterController';
		this.waterMeterAlarm = this.homey.flow.getDeviceTriggerCard('water_meter_alarm');
		this.waterMeterAlarm.registerRunListener(async (args, state) => args.alarm === state.alarm);
		this.waterMeterAlarmCleared = this.homey.flow.getDeviceTriggerCard('water_meter_alarm_cleared');
		this.waterMeterAlarmCleared.registerRunListener(async (args, state) => args.alarm === state.alarm);
		this.waterMeterFlowStarted = this.homey.flow.getDeviceTriggerCard('water_meter_flow_started');
		this.waterMeterFlowStopped = this.homey.flow.getDeviceTriggerCard('water_meter_flow_stopped');
		this.waterMeterDurationChanged = this.homey.flow.getDeviceTriggerCard('water_meter_duration_changed');
		this.waterMeterPowerChanged = this.homey.flow.getDeviceTriggerCard('water_meter_power_changed');
		this.waterMeterValveDelayChanged = this.homey.flow.getDeviceTriggerCard('water_meter_valve_delay_changed');
		this.waterMeterValveDelayChanged.registerRunListener(async (args, state) => args.delay === state.delay);
		this.homey.app.updateLog('WaterMeterController has been initialized');
	}

};
