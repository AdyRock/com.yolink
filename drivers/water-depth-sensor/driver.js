'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class WaterDepthSensorDriver extends yoLinkDriver
{

	/**
 * onInit is called when the driver is initialized.
 */
	async onInit()
	{
		this.deviceType = 'WaterDepthSensor';
		this.homey.app.updateLog('WaterDepthSensor has been initialized');
	}

};
