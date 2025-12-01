'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class DoorSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'DoorSensor';
		this.homey.app.updateLog('DoorSensorDriver has been initialized');
	}

	getIcon(modelNumber)
	{
		// the motion sensor has different icons for different models that are stored in the root/assest folder
		// remove the '-' suffix if present
		if (modelNumber.includes('-'))
		{
			modelNumber = modelNumber.split('-')[0];
		}
		switch (modelNumber)
		{
		case 'YS7706':
			return 'YS7706.svg';
		case 'YS7704':
			return 'YS7704.svg';
		case 'YS7707':
			return 'YS7707.svg';
		default:
			return 'YS7704.svg';
		}
	}

};
