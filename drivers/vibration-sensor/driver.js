'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class VibrationSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'VibrationSensor';
		this.homey.app.updateLog('VibrationSensor has been initialized');
	}

};
